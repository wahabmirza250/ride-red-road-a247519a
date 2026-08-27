import { describe, it, expect } from "vitest";
import {
  CLAIMS_NAV_SPEC,
  CLAIMS_NAV_STRATEGIES,
  isPortalNavigationFailure,
  PORTAL_NAV_USER_MESSAGE,
} from "@/lib/portalNavigation";
import {
  classifySubmitFailure,
  isPreSubmitPacingCondition,
  sanitizeSubmitError,
} from "@/lib/submitErrors";
import { requiresManualVerification } from "@/lib/needsVerification";
import { needsFixSummary } from "@/lib/needsFixCategory";

const LIVE_ERROR =
  "page.click: Timeout 30000ms exceeded.\n" +
  "Call log:\n  - waiting for locator('text=Claims')\n    at submitClaim.js:188";

describe("Claims navigation strategy", () => {
  it("offers several strategies before the legacy text locator", () => {
    expect(CLAIMS_NAV_STRATEGIES.length).toBeGreaterThan(3);
    const kinds = CLAIMS_NAV_STRATEGIES.map((s) => s.kind);
    expect(kinds).toContain("role");
    expect(kinds).toContain("menuitem");
    expect(kinds).toContain("href");
    // Brittle text locator is the LAST resort, not the first.
    expect(CLAIMS_NAV_STRATEGIES[CLAIMS_NAV_STRATEGIES.length - 1].kind).toBe("text");
  });

  it("waits for portal readiness and retries the step safely before form entry", () => {
    expect(CLAIMS_NAV_SPEC.readySelectors.length).toBeGreaterThan(0);
    expect(CLAIMS_NAV_SPEC.readyTimeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(CLAIMS_NAV_SPEC.maxAttempts).toBeGreaterThan(1);
    expect(CLAIMS_NAV_SPEC.retryDelayMs).toBeGreaterThan(0);
    expect(CLAIMS_NAV_SPEC.captureDiagnosticsOnFailure).toBe(true);
  });
});

describe("pre-submit navigation failure classification", () => {
  it("classifies the live worker-2 timeout as pre-submit portal_navigation", () => {
    expect(isPortalNavigationFailure(LIVE_ERROR)).toBe(true);
    expect(isPreSubmitPacingCondition(LIVE_ERROR)).toBe(true);
    expect(classifySubmitFailure(LIVE_ERROR)).toEqual({
      stage: "portal_navigation",
      code: "portal_navigation",
    });
    expect(sanitizeSubmitError(LIVE_ERROR)).toBe(PORTAL_NAV_USER_MESSAGE);
  });

  it("recognises a delayed SPA menu that never rendered", () => {
    const msg = "portal menu never rendered after login; Claims menu not found";
    expect(isPortalNavigationFailure(msg)).toBe(true);
    expect(classifySubmitFailure(msg).code).toBe("portal_navigation");
  });

  it("recognises an alternate-selector navigation failure", () => {
    const msg =
      "portal_navigation: unable to reach Claims via role/link/menuitem/href strategies (3 attempts)";
    expect(isPortalNavigationFailure(msg)).toBe(true);
  });

  it("never claims navigation for post-Submit or Step 1 outcomes", () => {
    expect(
      isPortalNavigationFailure("Confirm was clicked but the page timed out (Claims)"),
    ).toBe(false);
    expect(isPortalNavigationFailure("SUBMITTED_UNVERIFIED after Claims search")).toBe(false);
    expect(isPortalNavigationFailure("Still on Step 1 after clicking Continue")).toBe(false);
    expect(isPortalNavigationFailure("page.click: Timeout 30000ms exceeded")).toBe(false);
  });

  it("stays recoverable: never Needs Verification, shown as a waiting queue case", () => {
    const rec = {
      status: "queued",
      requires_human_step: false,
      submission_error: PORTAL_NAV_USER_MESSAGE,
      submit_last_error: LIVE_ERROR,
      failure_code: "portal_navigation",
    };
    expect(requiresManualVerification(rec as any)).toBe(false);
    const summary = needsFixSummary(rec as any);
    expect(summary.category).toBe("capacity");
    expect(summary.editable).toBe(false);
    expect(summary.label).toMatch(/portal menu/i);
  });

  it("does not force verification even when a stale human flag is set", () => {
    expect(
      requiresManualVerification({
        requires_human_step: true,
        failure_code: "portal_navigation",
        submit_last_error: LIVE_ERROR,
      } as any),
    ).toBe(false);
  });
});
