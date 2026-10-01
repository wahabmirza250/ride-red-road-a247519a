/** Keep readable fields when trip-count evidence is incomplete. Never invent a return. */
export function guardPaperLegs(parsed: Record<string, unknown>): Record<string, unknown> {
  const field = (key: string) => parsed[key] as { v?: unknown; c?: number } | undefined;
  const count = field("completed_legs");
  const certain = count && Number.isFinite(count.c) && count.c! >= 0.9 && [1, 2].includes(Number(count.v));
  const completeReturn = ["l2p", "l2d"].every(key => {
    const value = field(key);
    return value && Number.isFinite(value.c) && value.c! >= 0.9 && value.v != null && String(value.v).trim() !== "";
  });
  if (!certain || Number(count!.v) === 1 || !completeReturn) {
    return { ...parsed,
      leg_count_needs_review: !certain || Number(count!.v) === 2,
      ...Object.fromEntries(["l2p", "l2d", "l2pt", "l2dt"].map(k => [k, { v: null, c: 0 }])) };
  }
  return { ...parsed, leg_count_needs_review: false };
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
