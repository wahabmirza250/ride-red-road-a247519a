import { describe, expect, it } from "vitest";
import { APP_PREFIXES, isAppPath, isTenantLinkBlocked, withSlug } from "@/lib/appLink";

/**
 * Regression: the Compliance shield in the admin rail navigated to the bare
 * `/compliance` URL because "compliance" was missing from APP_PREFIXES, which
 * dropped the tenant slug and dead-ended on "You need your provider's link".
 */
describe("tenant-aware compliance navigation", () => {
  it("treats compliance (and siblings) as app paths", () => {
    for (const p of ["compliance", "communications", "salary", "payroll-statement"]) {
      expect(APP_PREFIXES.has(p)).toBe(true);
    }
    expect(isAppPath("/compliance")).toBe(true);
    expect(isAppPath("/compliance/passenger")).toBe(true);
  });

  it("resolves each company separately with no cross-company fallback", () => {
    expect(withSlug("walla", "/compliance/passenger")).toBe("/walla/compliance/passenger");
    expect(withSlug("lamar", "/compliance/passenger")).toBe("/lamar/compliance/passenger");
    expect(withSlug("walla", "/compliance/passenger")).not.toContain("lamar");
    expect(withSlug("lamar", "/compliance/passenger")).not.toContain("walla");
  });

  it("works for arbitrary slugs and any compliance subpage", () => {
    expect(withSlug("acme-rides", "/compliance")).toBe("/acme-rides/compliance");
    expect(withSlug("acme-rides", "/compliance/vehicles/42")).toBe(
      "/acme-rides/compliance/vehicles/42",
    );
  });

  it("blocks navigation instead of falling back to the generic route", () => {
    expect(isTenantLinkBlocked(null, "/compliance")).toBe(true);
    expect(withSlug(null, "/compliance")).toBe("/compliance");
    expect(isTenantLinkBlocked("walla", "/compliance")).toBe(false);
  });

  it("leaves public/non-app routes untouched", () => {
    expect(isTenantLinkBlocked(null, "/auth")).toBe(false);
    expect(withSlug("walla", "/auth")).toBe("/auth");
    expect(withSlug("walla", "/owner/signin")).toBe("/owner/signin");
    expect(withSlug("walla", "/passenger")).toBe("/walla/passenger");
  });
});
