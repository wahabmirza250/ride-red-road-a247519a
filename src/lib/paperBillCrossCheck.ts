const fields = ["completed_legs", "name", "driver_name", "medicaid_id", "trip_date", "vehicle_type", "l1p", "l1d", "l2p", "l2d", "l1pt", "l1dt", "l2pt", "l2dt"] as const;
/** Agreement reduces conflicting reads; it is not proof that handwriting was read correctly. */
export function crossCheckPaperReads(first: Record<string, unknown>, second: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of fields) {
    const a = first[key] as { v?: unknown; c?: number } | undefined;
    const b = second[key] as { v?: unknown; c?: number } | undefined;
    const norm = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim().replace(/\s+/g, " ").toLowerCase() : "";
    if (norm(a?.v) && norm(a?.v) === norm(b?.v) && Number.isFinite(a?.c) && Number.isFinite(b?.c) && a!.c! >= 0.9 && b!.c! >= 0.9) {
      result[key] = { v: a!.v, c: Math.min(a!.c!, b!.c!) };
    } else {
      result[key] = { v: null, c: 0 };
      if (norm(a?.v) || norm(b?.v)) conflicts.push(key);
    }
  }
  return { result, conflicts };
}
