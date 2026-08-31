import { describe, expect, it } from "vitest";
import { APP_PREFIXES, isAppPath, isTenantLinkBlocked, withSlug } from "@/lib/appLink";
import {
  ADMIN_NAV,
  INTERNAL_COMPLIANCE_PATH,
  complianceShieldTarget,
} from "@/lib/adminNav";

/**
 * Regression: the Compliance shield in the admin rail must open the INTERNAL
 * company compliance dashboard under the active tenant slug — never the public
 * passenger compliance surface, and never a bare slug-less URL.
 */
describe("tenant-aware compliance navigation", () => {
  it("treats compliance (and siblings) as app paths", () => {
    for (const p of ["compliance", "communications", "salary", "payroll-statement"]) {
      expect(APP_PREFIXES.has(p)).toBe(true);
    }
    expect(isAppPath("/compliance")).toBe(true);
  });

  it("keeps each tenant on its own compliance URL", () => {
    expect(complianceShieldTarget("walla")).toBe("/walla/compliance");
    expect(complianceShieldTarget("lamar")).toBe("/lamar/compliance");
    expect(complianceShieldTarget("walla")).not.toContain("lamar");
    expect(complianceShieldTarget("lamar")).not.toContain("walla");
  });

  it("never targets the passenger compliance surface", () => {
    for (const slug of ["walla", "lamar", "acme-rides", "zz-9"]) {
      const target = complianceShieldTarget(slug);
      expect(target).toBe(`/${slug}/compliance`);
      expect(target).not.toContain("/compliance/passenger");
      expect(target.endsWith("/passenger")).toBe(false);
    }
  });

  it("uses the internal compliance route in the admin rail", () => {
    const shield = ADMIN_NAV.find((i) => i.label === "Compliance");
    expect(shield?.to).toBe(INTERNAL_COMPLIANCE_PATH);
    expect(shield?.to).toBe("/compliance");
    expect(ADMIN_NAV.some((i) => i.to.includes("passenger"))).toBe(false);
    // Team & apps stays its own destination, distinct from Compliance.
    expect(ADMIN_NAV.find((i) => i.label === "Team & apps")?.to).toBe("/team");
  });

  it("blocks navigation instead of falling back when the slug is unknown", () => {
    expect(isTenantLinkBlocked(null, "/compliance")).toBe(true);
    expect(withSlug(null, "/compliance")).toBe("/compliance");
    expect(isTenantLinkBlocked("walla", "/compliance")).toBe(false);
  });

  it("leaves public passenger routes untouched", () => {
    expect(withSlug("walla", "/passenger/book")).toBe("/walla/passenger/book");
  });
});
