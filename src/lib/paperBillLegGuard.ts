/** Fail closed when the model cannot establish which printed trip rows are filled. */
export function guardPaperLegs(parsed: Record<string, unknown>) {
  const field = (key: string) => parsed[key] as { v?: unknown; c?: number } | undefined;
  const count = field("completed_legs");
  if (!count || typeof count.c !== "number" || count.c < 0.9 || ![1, 2].includes(Number(count.v))) {
    throw new Error("Could not verify the number of completed trips on the paper. Enter the trip details manually.");
  }
  if (Number(count.v) === 1) {
    return { ...parsed, ...Object.fromEntries(["l2p", "l2d", "l2pt", "l2dt"].map(k => [k, { v: null, c: 0 }])) };
  }
  for (const key of ["l2p", "l2d"]) {
    const value = field(key);
    if (!value || typeof value.c !== "number" || value.c < 0.9 || value.v == null || String(value.v).trim() === "") {
      throw new Error("The return trip is unclear. Check the original paper and enter the legs manually.");
    }
  }
  return parsed;
}

export function assertPaperLegReview(legs: unknown[], verified?: boolean) {
  if (legs.length === 2 && verified !== true) {
    throw new Error("Verify that the paper contains two completed trips before creating a two-unit bill.");
  }
}

/** OCR role assignment is disabled until document-level validation is proven. */
export function manualPaperIdentity() {
  return { name: null, driver_name: null, medicaid_id: null, rider: null,
    identity_manual_required: true, driver_name_match: { matched: false, score: 0, raw: null } };
}
export function assertPaperIdentityReview(verified?: boolean) {
  if (verified !== true) throw new Error("Check passenger name, Medicaid ID and driver against the original paper before creating this bill.");
}
