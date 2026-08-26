import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("dispatch consolidation (games preserved)", () => {
  it("admin navigation has one Dispatch destination, no Planner, and visible Games access", () => {
    const nav = read("src/routes/$companySlug/_authenticated/route.tsx");
    expect(nav).not.toMatch(/"\/planner"/);
    expect(nav).toMatch(/\{ to: "\/games", label: "Games", icon: Gamepad2 \}/);
    expect(nav).toMatch(/<AppLink[\s\S]*?to="\/games"[\s\S]*?aria-label="Games"/);
    expect(nav).toMatch(/\{ to: "\/live-ops", label: "Dispatch"/);
  });

  it("legacy planner URL redirects into the dispatch workspace plan tab", () => {
    const src = read("src/routes/$companySlug/_authenticated/planner.tsx");
    expect(src).toMatch(/redirect\(/);
    expect(src).toMatch(/\/\$companySlug\/live-ops/);
    expect(src).toMatch(/tab: "plan"/);
  });

  it("keeps the real Games admin page and passenger games page", () => {
    const admin = read("src/routes/$companySlug/_authenticated/games.tsx");
    expect(admin).toMatch(/createFileRoute\("\/\$companySlug\/_authenticated\/games"\)/);
    expect(admin).not.toMatch(/redirect\(/);
    expect(admin).toMatch(/from\("games"\)/);

    const passenger = read("src/routes/$companySlug/passenger.games.tsx");
    expect(passenger).toMatch(/createFileRoute\("\/\$companySlug\/passenger\/games"\)/);
    expect(passenger).not.toMatch(/redirect\(/);
    expect(passenger).toMatch(/listPublicGames/);
    const passengerShell = read("src/routes/$companySlug/passenger.tsx");
    expect(passengerShell).toMatch(/\{ to: "\/passenger\/games", label: "Games", icon: Gamepad2 \}/);
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
