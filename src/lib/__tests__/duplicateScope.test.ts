/**
 * DUPLICATE SCOPE — the guard is per TRIP / per submission intent, never per
 * passenger and never per service date.
 *
 * A member legitimately takes several trips in one day (there and back, two
 * appointments, a group tour leg). Those are distinct billable claims and must
 * all be submittable. Only the SAME underlying trip/billing record may be
 * collapsed as a duplicate.
 */
import { describe, expect, it } from "vitest";
import {
  buildIdempotencyKey,
  nextVersionKey,
  versionOfKey,
} from "@/lib/submissionIdempotency";
import {
  SAME_DAY_WARNING,
  findSameDayGroups,
  sameDayFlaggedTripIds,
} from "@/lib/sameDayBilling";
import { duplicateClaimError, parseDuplicateClaimError } from "@/lib/duplicateSubmit";

const base = {
  accountKey: "acct:hfc-colorado:londonalfieri22",
  companyId: "co-1",
  serviceDate: "2026-07-30T14:00:00Z",
};

describe("duplicate scope is the trip, not the passenger-day", () => {
  it("gives two DIFFERENT trips for the same member on the same date different keys", () => {
    const a = buildIdempotencyKey({ ...base, tripId: "trip-morning" });
    const b = buildIdempotencyKey({ ...base, tripId: "trip-afternoon" });
    expect(a).not.toBe(b);
  });

  it("collapses repeated clicks on the SAME trip to one key", () => {
    const a = buildIdempotencyKey({ ...base, tripId: "trip-1" });
    const b = buildIdempotencyKey({ ...base, tripId: "trip-1" });
    expect(a).toBe(b);
  });

  it("keeps the original/resubmission relationship through version bumps", () => {
    const v1 = buildIdempotencyKey({ ...base, tripId: "trip-1" });
    expect(versionOfKey(v1)).toBe(1);
    const v2 = nextVersionKey(v1, { ...base, tripId: "trip-1" });
    expect(versionOfKey(v2)).toBe(2);
    // Same trip and same service date — only the version differs.
    expect(v2.replace(/\|v\d+$/, "")).toBe(v1.replace(/\|v\d+$/, ""));
    expect(versionOfKey(nextVersionKey(v2, { ...base, tripId: "trip-1" }))).toBe(3);
  });

  it("same member + same date is a WARNING only — it never blocks or adds a modifier", () => {
    const trips = [
      { trip_id: "t1", company_id: "co-1", medicaid_id: "M1", service_date: "2026-07-30T09:00:00Z" },
      { trip_id: "t2", company_id: "co-1", medicaid_id: "M1", service_date: "2026-07-30T15:00:00Z" },
    ];
    const groups = findSameDayGroups(trips);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.trip_ids.sort()).toEqual(["t1", "t2"]);

    // Both trips are only FLAGGED. Nothing here removes, merges or blocks one.
    const flagged = sameDayFlaggedTripIds(trips);
    expect(flagged.has("t1")).toBe(true);
    expect(flagged.has("t2")).toBe(true);
    expect(SAME_DAY_WARNING).toMatch(/Review before submitting/i);
    expect(SAME_DAY_WARNING).toMatch(/no modifier has been applied/i);

    // …and their submission intents stay independent.
    expect(buildIdempotencyKey({ ...base, tripId: "t1" })).not.toBe(
      buildIdempotencyKey({ ...base, tripId: "t2" }),
    );
  });

  it("different members on the same date are never grouped at all", () => {
    expect(
      findSameDayGroups([
        { trip_id: "t1", company_id: "co-1", medicaid_id: "M1", service_date: "2026-07-30" },
        { trip_id: "t2", company_id: "co-1", medicaid_id: "M2", service_date: "2026-07-30" },
      ]),
    ).toEqual([]);
  });

  it("the duplicate dialog only ever describes an existing claim on THIS record", () => {
    const info = parseDuplicateClaimError(
      duplicateClaimError({ claim: "2326239001622", status: "submitted", unverified: false }),
    );
    expect(info).toMatchObject({ claim: "2326239001622", status: "submitted" });
    // A plain data error is never treated as a duplicate.
    expect(parseDuplicateClaimError(new Error("Indicates a required field."))).toBeNull();
  });
});
