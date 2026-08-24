import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_VERSION,
  classifyDestination,
  normalizeDestinationKey,
} from "@/lib/destinationClassifier";
import {
  buildClassificationRows,
  buildOverrideRow,
  classifyTripDestination,
  selectLookupTargets,
  type CacheRow,
} from "@/lib/destinationReview.server";

const place = (name: string, types: string[] = [], address = "1 Main St, Denver CO") => ({
  name,
  types,
  address,
});

const cacheRow = (key: string, row: Partial<CacheRow>): CacheRow =>
  ({
    normalized_key: key,
    address: key,
    place: null,
    nearby: [],
    lookup_ok: true,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...row,
  }) as CacheRow;

describe("destination classifier", () => {
  it("treats a multi-clinic medical building as medical even with a generic building name", () => {
    const res = classifyDestination({
      address: "1400 Jackson St, Denver CO",
      name: "Jackson Professional Building",
      place: place("Jackson Professional Building", ["establishment"]),
      nearby: [
        place("Front Range Family Medicine Clinic", ["doctor", "health"]),
        place("Denver Imaging Center", ["health"]),
        place("Cafe Nine", ["cafe"]),
      ],
    });
    expect(["medical_confident", "medical_possible"]).toContain(res.status);
    expect(res.status).not.toBe("review_non_medical");
  });

  it("classifies a Walgreens pharmacy as medical", () => {
    const res = classifyDestination({
      address: "2000 Broadway, Denver CO",
      name: "Walgreens",
      place: place("Walgreens", ["pharmacy", "store"]),
    });
    expect(res.status).toBe("medical_confident");
  });

  it("classifies Walmart WITH explicit pharmacy evidence as medical", () => {
    const res = classifyDestination({
      address: "5155 Fountain Blvd, Colorado Springs CO",
      name: "Walmart Pharmacy",
      place: place("Walmart Pharmacy", ["pharmacy", "store"]),
    });
    expect(res.status).toBe("medical_confident");
  });

  it("flags a generic Walmart with no medical evidence for review, never auto-medical", () => {
    const res = classifyDestination({
      address: "5155 Fountain Blvd, Colorado Springs CO",
      name: "Walmart Supercenter",
      place: place("Walmart Supercenter", ["department_store", "store"]),
    });
    expect(res.status).toBe("review_non_medical");
    expect(res.summary.toLowerCase()).not.toContain("not covered");
  });

  it("treats a recovery / substance-use treatment center as medical or behavioral", () => {
    const res = classifyDestination({
      address: "77 Recovery Way, Pueblo CO",
      name: "Sandstone Recovery & Treatment Center",
      place: place("Sandstone Recovery & Treatment Center", ["health", "establishment"]),
    });
    expect(["medical_confident", "medical_possible"]).toContain(res.status);
  });

  it("treats an AA/NA-style recovery meeting venue with credible context as a behavioral candidate", () => {
    const res = classifyDestination({
      address: "500 Elm St, Denver CO",
      name: "Serenity Club — AA meeting hall",
      place: place("Serenity Club", ["establishment"]),
      nearby: [place("Narcotics Anonymous Meeting Room", ["establishment"])],
    });
    expect(res.status).not.toBe("review_non_medical");
  });

  it("does not treat the bare word 'recovery' with no context as medical evidence alone", () => {
    const res = classifyDestination({
      address: "12 Recovery Auto Towing, Denver CO",
      name: "Recovery Auto Towing",
      place: place("Recovery Auto Towing", ["car_repair"]),
    });
    expect(res.status).not.toBe("medical_confident");
  });

  it("flags a plain residence for review", () => {
    const res = classifyDestination({
      address: "812 S Bannock St Apt 4, Denver CO 80223",
      place: place("812 S Bannock St", ["premise"]),
    });
    expect(["review_non_medical", "unknown"]).toContain(res.status);
  });

  it("returns unknown when there is no destination text at all", () => {
    const res = classifyDestination({ address: "", name: "" });
    expect(res.status).toBe("unknown");
  });

  it("returns unknown (never non-medical) when the place provider fails", () => {
    const res = classifyDestination({
      address: "5155 Fountain Blvd, Colorado Springs CO",
      place: null,
      providerFailed: true,
    });
    expect(res.status).not.toBe("review_non_medical");
  });

  it("normalizes destination keys so the cache is shared across formatting noise", () => {
    expect(normalizeDestinationKey("  1400 Jackson St., Denver, CO  ")).toBe(
      normalizeDestinationKey("1400 jackson st, denver co"),
    );
  });
});

describe("classification batching and cache", () => {
  it("only looks up cache misses and defers beyond the rate limit", () => {
    const cache = new Map<string, CacheRow>([["a", cacheRow("a", {})]]);
    const { fetch, deferred } = selectLookupTargets(["a", "b", "c", "d"], cache, new Date(), 2);
    expect(fetch).toEqual(["b", "c"]);
    expect(deferred).toEqual(["d"]);
  });

  it("refetches an expired cache entry", () => {
    const cache = new Map<string, CacheRow>([
      ["a", cacheRow("a", { expires_at: new Date(Date.now() - 1000).toISOString() })],
    ]);
    expect(selectLookupTargets(["a"], cache).fetch).toEqual(["a"]);
  });

  it("marks deferred lookups as unknown rather than flagging them", () => {
    const key = normalizeDestinationKey("5155 Fountain Blvd, Colorado Springs CO");
    const res = classifyTripDestination(
      { trip_id: "t1", company_id: "c1", destination: "5155 Fountain Blvd, Colorado Springs CO" },
      new Map(),
      new Set([key]),
    );
    expect(res.status).not.toBe("review_non_medical");
  });

  it("builds additive rows that carry evidence, version and tenant, and no claim fields", () => {
    const key = normalizeDestinationKey("2000 Broadway, Denver CO");
    const cache = new Map<string, CacheRow>([
      [key, cacheRow(key, { place: place("Walgreens", ["pharmacy"]) })],
    ]);
    const rows = buildClassificationRows(
      [
        {
          trip_id: "t1",
          company_id: "company-1",
          destination: "2000 Broadway, Denver CO",
          destination_name: "Walgreens",
        },
      ],
      cache,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].company_id).toBe("company-1");
    expect(rows[0].classifier_version).toBe(CLASSIFIER_VERSION);
    expect(rows[0].status).toBe("medical_confident");
    expect(rows[0].evidence.place_lookup).toBe("ok");
    // Never writes back onto the trip/claim itself.
    expect(Object.keys(rows[0])).not.toContain("dropoff_address");
    expect(Object.keys(rows[0])).not.toContain("claim_amount");
  });

  it("keeps tenants separate: each row carries its own company_id", () => {
    const rows = buildClassificationRows(
      [
        { trip_id: "t1", company_id: "c1", destination: "1 A St" },
        { trip_id: "t2", company_id: "c2", destination: "2 B St" },
      ],
      new Map(),
    );
    expect(rows.map((r) => r.company_id)).toEqual(["c1", "c2"]);
  });
});

describe("override audit", () => {
  it("records who, when, the original classification and the note", () => {
    const row = buildOverrideRow({
      trip_id: "t1",
      billing_record_id: "b1",
      company_id: "c1",
      classification: { id: "cl1", status: "review_non_medical", summary: "Retail, no evidence" },
      note: "  Member confirmed pharmacy pickup  ",
      actor_id: "user-1",
    });
    expect(row).toMatchObject({
      trip_id: "t1",
      billing_record_id: "b1",
      company_id: "c1",
      classification_id: "cl1",
      original_status: "review_non_medical",
      overridden_by: "user-1",
      note: "Member confirmed pharmacy pickup",
    });
  });

  it("defaults to unknown when no classification exists and never carries a submit flag", () => {
    const row = buildOverrideRow({
      trip_id: "t1",
      billing_record_id: null,
      company_id: null,
      classification: null,
      actor_id: null,
    });
    expect(row.original_status).toBe("unknown");
    expect(row.note).toBeNull();
    expect(Object.keys(row)).not.toContain("submit");
    expect(Object.keys(row)).not.toContain("status");
  });
});

describe("no HCPF coupling", () => {
  it("classification and override modules never reference the submission robot", async () => {
    const fs = await import("node:fs/promises");
    for (const f of [
      "src/lib/destinationClassifier.ts",
      "src/lib/destinationReview.server.ts",
      "src/lib/destinationReview.functions.ts",
    ]) {
      const src = await fs.readFile(f, "utf8");
      expect(src).not.toMatch(/robotAdapter|startRobotForRecords|submitClaim|robotQueue/);
    }
  });
});
