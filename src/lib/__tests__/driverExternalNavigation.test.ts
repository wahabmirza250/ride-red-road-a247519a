import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { googleMapsDirectionsUrl } from "@/lib/mapsDeepLink";

const read = (path: string) => readFileSync(path, "utf8");

describe("driver external navigation", () => {
  it("builds driving directions with coordinates and an address fallback", () => {
    expect(googleMapsDirectionsUrl({ lat: 39.7392, lng: -104.9903, address: "ignored" }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=39.7392%2C-104.9903&travelmode=driving&dir_action=navigate");
    expect(googleMapsDirectionsUrl({ address: "100 Main St, Denver CO" }))
      .toContain("destination=100%20Main%20St%2C%20Denver%20CO");
  });

  it("uses a synchronous top-level handoff instead of a popup", () => {
    const helper = read("src/lib/mapsDeepLink.ts");
    expect(helper).toContain("window.location.assign(url)");
    expect(helper).not.toContain("window.open(");
  });

  it("keeps route overview internal and makes rendered start actions external", () => {
    const home = read("src/routes/$companySlug/driver.index.tsx");
    expect(home).toMatch(/onStartNavigation=\{openNavigation\}/);
    expect(home).toMatch(/onRouteOverview=\{\(\) => setNavOpen\(true\)\}/);
    expect(home).not.toMatch(/Start Navigation[\s\S]{0,250}setNavOpen\(true\)/);
    expect(home).not.toMatch(/Resume navigation|Navigate to pickup|Navigate to dropoff/);

    const active = read("src/routes/$companySlug/driver.trip.active.tsx");
    expect(active).toMatch(/onStartNavigation=\{dest \? \(\) => openNavigation/);
    expect(active).toMatch(/onRouteOverview=\{destCoords \? \(\) => setNavOpen\(true\)/);
    expect(active).not.toContain("Turn-by-turn in app");

    const journey = read("src/components/driver/ActiveJourneyCard.tsx");
    expect(journey).toMatch(/openNavigation\(\{ lat: next\.lat, lng: next\.lng, address: next\.address \}\)/);
    expect(journey).toMatch(/onClick=\{\(\) => setNavOpen\(true\)\}[\s\S]*?Route Overview/);
  });
});