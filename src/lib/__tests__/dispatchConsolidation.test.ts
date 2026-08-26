import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("dispatch consolidation + games removal", () => {
  it("admin navigation has a single Dispatch destination and no Planner or Games entries", () => {
    const nav = read("src/routes/$companySlug/_authenticated/route.tsx");
    expect(nav).not.toMatch(/"\/planner"/);
    expect(nav).not.toMatch(/"\/games"/);
    expect(nav).not.toMatch(/Gamepad2/);
    expect(nav).toMatch(/\{ to: "\/live-ops", label: "Dispatch"/);
  });

  it("legacy planner URL redirects into the dispatch workspace plan tab", () => {
    const src = read("src/routes/$companySlug/_authenticated/planner.tsx");
    expect(src).toMatch(/redirect\(/);
    expect(src).toMatch(/\/\$companySlug\/live-ops/);
    expect(src).toMatch(/tab: "plan"/);
  });

  it("legacy games URLs redirect instead of 404", () => {
    expect(read("src/routes/$companySlug/_authenticated/games.tsx")).toMatch(
      /\/\$companySlug\/dashboard/,
    );
    expect(read("src/routes/$companySlug/passenger.games.tsx")).toMatch(
      /\/\$companySlug\/passenger/,
    );
  });

  it("dispatch app exposes Plan as an internal tab", () => {
    const layout = read("src/routes/$companySlug/dispatch.tsx");
    expect(layout).toMatch(/to: "\/dispatch\/plan", label: "Plan"/);
    const route = read("src/routes/$companySlug/dispatch.plan.tsx");
    expect(route).toMatch(/PlanRidesPanel/);
  });

  it("planning logic is shared, not duplicated", () => {
    const panel = read("src/components/dispatch/PlanRidesPanel.tsx");
    for (const fn of ["getPlannableRides", "adminReassignDriver", "rescheduleRide"]) {
      expect(panel).toContain(fn);
    }
    const workspace = read("src/routes/$companySlug/_authenticated/live-ops.tsx");
    expect(workspace).toMatch(/PlanRidesPanel/);
  });
});
