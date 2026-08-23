/**
 * Manual, OPTIONAL Medicaid verification state for the DRIVER self-created
 * trip flow.
 *
 * Field drivers cannot wait 2–4 minutes for a portal lookup, so nothing here
 * ever starts a verification on its own: selecting a passenger, opening a step
 * or navigating the wizard leaves the state untouched. Verification only runs
 * when the driver taps "Verify Medicaid", and its outcome is informational —
 * it never blocks Continue, Review, PDF generation or Submit to billing.
 */

export type RiderVerifyStatus = "matched" | "mismatch" | "unavailable" | "skipped";

export type RiderVerifyResultLike = {
  status: RiderVerifyStatus | string;
  message: string;
  portal_name?: string | null;
};

export type VerifyEntry = {
  state: "running" | "done";
  result?: RiderVerifyResultLike;
};

export type VerifyMap = Record<string, VerifyEntry>;

export type VerifyLabel = "Not checked" | "Checking…" | "Verified" | "Mismatch" | "Unavailable";

/**
 * Called whenever the rider slots change. Intentionally a no-op for unknown
 * riders — it only drops state for riders that are no longer on the trip.
 */
export function syncVerifyMapToRiders(map: VerifyMap, riderIds: string[]): VerifyMap {
  const keep = new Set(riderIds);
  const next: VerifyMap = {};
  for (const [id, entry] of Object.entries(map)) {
    if (keep.has(id)) next[id] = entry;
  }
  return next;
}

/**
 * Mark a rider as verifying. `shouldRequest` is false when a request is
 * already in flight, so a double tap can never fire two lookups.
 */
export function beginVerify(
  map: VerifyMap,
  riderId: string,
): { next: VerifyMap; shouldRequest: boolean } {
  if (map[riderId]?.state === "running") return { next: map, shouldRequest: false };
  return { next: { ...map, [riderId]: { state: "running" } }, shouldRequest: true };
}

export function completeVerify(
  map: VerifyMap,
  riderId: string,
  result: RiderVerifyResultLike,
): VerifyMap {
  return { ...map, [riderId]: { state: "done", result } };
}

export function failVerify(map: VerifyMap, riderId: string, message: string): VerifyMap {
  return completeVerify(map, riderId, { status: "unavailable", message, portal_name: null });
}

export function verificationLabel(entry?: VerifyEntry): VerifyLabel {
  if (!entry) return "Not checked";
  if (entry.state === "running") return "Checking…";
  const status = entry.result?.status;
  if (status === "matched") return "Verified";
  if (status === "mismatch") return "Mismatch";
  if (status === "unavailable") return "Unavailable";
  return "Not checked";
}

/**
 * Driver-created trips always go to billing for staff review, so verification
 * state — including "Not checked" — never blocks submission.
 */
export function verificationBlocksSubmit(_map: VerifyMap, _riderIds: string[]): boolean {
  return false;
}

/** Non-blocking warnings surfaced on Review. */
export function verificationWarnings(
  map: VerifyMap,
  riders: Array<{ id: string; name: string }>,
): string[] {
  const out: string[] = [];
  for (const r of riders) {
    const label = verificationLabel(map[r.id]);
    if (label === "Mismatch" || label === "Unavailable") {
      out.push(map[r.id]?.result?.message || `${r.name}: Medicaid ID ${label.toLowerCase()}`);
    }
  }
  return out;
}
