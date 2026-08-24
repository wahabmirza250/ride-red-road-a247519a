import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Layout regression: the driver wizard's fixed CTA must always clear the
 * floating bottom nav and the iOS home indicator.
 */
describe("driver bottom chrome offsets", () => {
  const css = read("src/styles.css");

  it("defines safe-area aware nav offset variables", () => {
    expect(css).toContain("--driver-safe-bottom: env(safe-area-inset-bottom, 0px)");
    expect(css).toMatch(/--driver-nav-height:\s*5rem/);
    expect(css).toMatch(/--driver-nav-gap:\s*0\.75rem/);
    expect(css).toMatch(/--driver-nav-offset:[\s\S]*var\(--driver-safe-bottom\)/);
  });

  it("keeps the CTA sticky above the nav and pads the shell below it", () => {
    expect(css).toMatch(/\.driver-cta-bar\s*{[\s\S]*position:\s*sticky/);
    expect(css).toMatch(/\.driver-cta-bar\s*{[\s\S]*bottom:\s*var\(--driver-nav-offset\)/);
    expect(css).toMatch(/\.driver-nav-pad\s*{[\s\S]*calc\(var\(--driver-nav-offset\) \+ 1rem\)/);
    expect(css).toMatch(/\.driver-step-header\s*{[\s\S]*position:\s*sticky/);
  });

  it("driver layout uses the safe-area nav position, not a raw bottom-3", () => {
    const layout = read("src/routes/$companySlug/driver.tsx");
    expect(layout).toContain("driver-nav-pad");
    expect(layout).toContain("var(--driver-safe-bottom) + var(--driver-nav-gap)");
    expect(layout).not.toMatch(/fleet-bottom-nav fixed bottom-3/);
  });

  it("create + active trip screens use shared CTA classes, one layer each", () => {
    for (const file of [
      "src/routes/$companySlug/driver.trip.new.tsx",
      "src/routes/$companySlug/driver.trip.active.tsx",
    ]) {
      const src = read(file);
      expect(src).toContain("driver-cta-bar");
      expect(src).toContain("driver-step-header");
      expect(src).toContain("driver-cta-content-pad");
      expect(src).not.toMatch(/fixed inset-x-0 bottom-0/);
    }
  });
});

