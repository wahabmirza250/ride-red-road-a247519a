import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveRowCompanyId,
  serviceRoleBypassesTenantPolicy,
  tenantPolicyAllows,
} from "@/lib/tenantIsolation";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("child-row tenant isolation predicate", () => {
  it("denies a dispatcher from another company (trip_stops / ride_passengers)", () => {
    expect(tenantPolicyAllows({ userCompanyId: B }, { tripCompanyId: A })).toBe(false);
    expect(tenantPolicyAllows({ userCompanyId: B }, { requestCompanyId: A })).toBe(false);
  });

  it("denies a dispatcher from another company (route_stops)", () => {
    expect(tenantPolicyAllows({ userCompanyId: B }, { routeCompanyId: A })).toBe(false);
  });

  it("allows same-company access on every parent path", () => {
    expect(tenantPolicyAllows({ userCompanyId: A }, { tripCompanyId: A })).toBe(true);
    expect(tenantPolicyAllows({ userCompanyId: A }, { routeCompanyId: A })).toBe(true);
    expect(tenantPolicyAllows({ userCompanyId: A }, { requestCompanyId: A })).toBe(true);
  });

  it("falls back from trip to ride request for manifest rows", () => {
    expect(resolveRowCompanyId({ tripCompanyId: null, requestCompanyId: B })).toBe(B);
    expect(tenantPolicyAllows({ userCompanyId: B }, { tripCompanyId: null, requestCompanyId: B })).toBe(
      true,
    );
  });

  it("denies rows with no resolvable parent company, and users with no company", () => {
    expect(tenantPolicyAllows({ userCompanyId: A }, {})).toBe(false);
    expect(tenantPolicyAllows({ userCompanyId: null }, { tripCompanyId: A })).toBe(false);
  });

  it("keeps platform-owner cross-company view and service-role worker access", () => {
    expect(tenantPolicyAllows({ userCompanyId: null, ownerUnscoped: true }, { tripCompanyId: A })).toBe(
      true,
    );
    expect(serviceRoleBypassesTenantPolicy()).toBe(true);
  });
});

describe("shipped migration enforces the same rule in SQL", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  for (const [table, fn] of [
    ["trip_stops", "company_of_trip(trip_id)"],
    ["route_stops", "company_of_route(route_id)"],
    ["ride_passengers", "company_of_trip(trip_id)"],
  ] as const) {
    it(`${table} has a restrictive, authenticated-scoped tenant_isolation policy`, () => {
      const policy = sql.slice(sql.indexOf(`CREATE POLICY tenant_isolation ON public.${table}`));
      expect(policy).toContain("AS RESTRICTIVE FOR ALL TO authenticated");
      expect(policy).toContain("current_user_company_id()");
      expect(policy).toContain(fn);
      // Both read and write paths are constrained.
      expect(policy.slice(0, 900)).toContain("WITH CHECK");
    });
  }

  it("does not grant the company lookup helpers to anon", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.company_of_trip(uuid) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.company_of_trip(uuid) TO authenticated, service_role;");
  });
});
