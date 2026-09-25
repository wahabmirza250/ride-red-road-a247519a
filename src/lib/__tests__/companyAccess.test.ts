import { describe, it, expect } from "vitest";
import { COMPANY_APPS, companyAppHref, normalizeCompanyCode } from "../companyAccess";
describe("company entry links", () => {
  it("normalizes typed company codes", () => { expect(normalizeCompanyCode(" WALLA ")).toBe("walla"); });
  it.each(["../walla", "https://example.com", "a/b", "a?x=1", "-walla", "walla--x", "a", "a".repeat(41), "billing", "access", "mobile"])("rejects unsafe or reserved code %s", value => { expect(() => normalizeCompanyCode(value)).toThrow(); });
  it("opens the chooser from a code alone", () => { expect(companyAppHref("walla")).toBe("/walla"); });
  it("preserves each app under the same company", () => {
    expect(COMPANY_APPS.map(app => companyAppHref("WALLA", app.key))).toEqual(["/walla/login", "/walla/driver/signin", "/walla/passenger/signin", "/walla/billing/signin", "/walla/dispatch/signin"]);
  });
});
