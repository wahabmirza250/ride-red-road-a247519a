import { describe, expect, it } from "vitest";
import {
  evaluateBillingSetup,
  pickDefaultProvider,
  submissionBlockedReason,
  type BillingSetupInput,
} from "./billingSetup";

const base: BillingSetupInput = {
  providerId: null,
  portalId: null,
  credentialPortalIds: [],
  rates: [],
};

const fullRates = [
  { vehicle_type: "ambulatory", unit_type: "trip" },
  { vehicle_type: "ambulatory", unit_type: "mile" },
];

describe("billing onboarding readiness", () => {
  it("a brand-new company is not ready but has actionable steps", () => {
    const s = evaluateBillingSetup(base);
    expect(s.ready).toBe(false);
    expect(s.missing).toEqual(["provider", "portal", "rates"]);
    expect(s.steps.every((x) => x.detail.length > 10)).toBe(true);
  });

  it("provider can be saved with zero rate rows", () => {
    const s = evaluateBillingSetup({ ...base, providerId: "u1" });
    expect(s.steps[0]!.done).toBe(true);
    expect(s.missing).toEqual(["portal", "rates"]);
  });

  it("portal is only done when the default portal has a company credential", () => {
    expect(
      evaluateBillingSetup({ ...base, portalId: "hcpf-colorado" }).steps[1]!.done,
    ).toBe(false);
    expect(
      evaluateBillingSetup({ ...base, credentialPortalIds: ["hcpf-colorado"] }).steps[1]!.done,
    ).toBe(false);
    expect(
      evaluateBillingSetup({
        ...base,
        portalId: "hcpf-colorado",
        credentialPortalIds: ["hcpf-colorado"],
      }).steps[1]!.done,
    ).toBe(true);
  });

  it("requires both trip and mile ambulatory rates", () => {
    expect(
      evaluateBillingSetup({ ...base, rates: [fullRates[0]!] }).steps[2]!.done,
    ).toBe(false);
    expect(evaluateBillingSetup({ ...base, rates: fullRates }).steps[2]!.done).toBe(true);
  });

  it("is ready only with provider + portal credential + rates", () => {
    const s = evaluateBillingSetup({
      providerId: "u1",
      portalId: "hcpf-colorado",
      credentialPortalIds: ["hcpf-colorado"],
      rates: fullRates,
    });
    expect(s.ready).toBe(true);
    expect(submissionBlockedReason(s)).toBeNull();
  });

  it("explains blocked submission in plain language", () => {
    const msg = submissionBlockedReason(evaluateBillingSetup(base))!;
    expect(msg).toContain("billing provider");
    expect(msg).toContain("state portal login");
    expect(msg).toContain("trip and mileage rates");
  });

  it("preselects the only eligible provider and keeps an existing choice", () => {
    const one = [{ id: "u1", name: "Lamar LA", email: null, roles: ["admin"] }];
    expect(pickDefaultProvider(one, null)).toBe("u1");
    expect(
      pickDefaultProvider(
        [...one, { id: "u2", name: "Other", email: null, roles: ["billing"] }],
        null,
      ),
    ).toBeNull();
    expect(pickDefaultProvider(one, "u1")).toBe("u1");
    // a stale cross-company id is never kept
    expect(pickDefaultProvider(one, "other-company-user")).toBe("u1");
  });
});
