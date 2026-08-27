import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  billingSettingsPolicyAllows,
  rideRequestPolicyAllows,
  serviceRoleBypassesTenantPolicy,
} from "@/lib/tenantIsolation";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";
const PASSENGER_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const PASSENGER_2 = "aaaaaaaa-0000-0000-0000-000000000002";

const rowP1 = { passengerUserId: PASSENGER_1, companyId: COMPANY_A };

describe("ride_requests passenger access", () => {
  it("lets a passenger read their own request", () => {
    expect(
      rideRequestPolicyAllows(
        { userId: PASSENGER_1, userCompanyId: COMPANY_A, roles: ["passenger"] },
        rowP1,
      ),
    ).toBe(true);
  });

  it("denies another passenger in the same company", () => {
    expect(
      rideRequestPolicyAllows(
        { userId: PASSENGER_2, userCompanyId: COMPANY_A, roles: ["passenger"] },
        rowP1,
      ),
    ).toBe(false);
  });

  it("denies a passenger from another company outright", () => {
    expect(
      rideRequestPolicyAllows(
        { userId: PASSENGER_2, userCompanyId: COMPANY_B, roles: ["passenger"] },
        rowP1,
      ),
    ).toBe(false);
  });

  it("preserves admin and dispatch access within their own company", () => {
    expect(
      rideRequestPolicyAllows({ userId: "admin-1", userCompanyId: COMPANY_A, roles: ["admin"] }, rowP1),
    ).toBe(true);
    expect(
      rideRequestPolicyAllows(
        { userId: "disp-1", userCompanyId: COMPANY_A, roles: ["dispatch"] },
        rowP1,
      ),
    ).toBe(true);
  });

  it("denies admin and dispatch from a different company", () => {
    expect(
      rideRequestPolicyAllows({ userId: "admin-2", userCompanyId: COMPANY_B, roles: ["admin"] }, rowP1),
    ).toBe(false);
    expect(
      rideRequestPolicyAllows(
        { userId: "disp-2", userCompanyId: COMPANY_B, roles: ["dispatch"] },
        rowP1,
      ),
    ).toBe(false);
  });

  it("keeps platform-owner visibility and service-role worker access", () => {
    expect(
      rideRequestPolicyAllows(
        { userId: "owner", userCompanyId: null, ownerUnscoped: true, roles: ["admin"] },
        rowP1,
      ),
    ).toBe(true);
    expect(serviceRoleBypassesTenantPolicy()).toBe(true);
  });
});

describe("billing_settings company scoping", () => {
  it("allows a biller/admin to read only their own company's settings", () => {
    expect(billingSettingsPolicyAllows({ userCompanyId: COMPANY_A }, { companyId: COMPANY_A })).toBe(
      true,
    );
    expect(billingSettingsPolicyAllows({ userCompanyId: COMPANY_B }, { companyId: COMPANY_A })).toBe(
      false,
    );
  });

  it("keeps the platform-owner cross-company view", () => {
    expect(
      billingSettingsPolicyAllows({ userCompanyId: null, ownerUnscoped: true }, { companyId: COMPANY_A }),
    ).toBe(true);
  });

  it("ships a restrictive tenant_isolation policy in SQL", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const idx = sql.indexOf('CREATE POLICY "tenant_isolation" ON public.billing_settings');
    expect(idx).toBeGreaterThan(-1);
    const policy = sql.slice(idx, idx + 500);
    expect(policy).toContain("AS RESTRICTIVE");
    expect(policy).toContain("TO authenticated");
    expect(policy).toContain("current_user_company_id()");
    expect(policy).toContain("owner_unscoped()");
    expect(policy).toContain("WITH CHECK");
  });
});
