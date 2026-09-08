/**
 * WHERE DO CORRECTED COPIES BELONG RIGHT NOW? (server-only)
 *
 * `claim_resubmissions.status = 'processing'` only says a copy was handed to
 * the robot once. It says nothing about now. This module asks the billing
 * record whether a worker still holds a LIVE lease, and routes everything else
 * to Verification Hold, where a person (or the read-only portal search) can
 * settle it.
 */
import { splitCorrectedProcessing, type LiveJobInput } from "@/lib/processingLive";

type Sb = any;

export async function loadLeases(
  supabase: Sb,
  recordIds: string[],
): Promise<Map<string, LiveJobInput>> {
  const map = new Map<string, LiveJobInput>();
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data } = await supabase
    .from("billing_records")
    .select("id, status, submit_locked_until, submit_heartbeat_at, submit_lease_started_at, submit_worker")
    .in("id", ids);
  for (const r of ((data ?? []) as any[])) map.set(r.id, r as LiveJobInput);
  return map;
}

/** Split the company's `processing` corrected rows into live vs held. */
export async function correctedProcessingSplit<
  T extends { id: string; submission_billing_record_id?: string | null },
>(supabase: Sb, rows: T[], now: number = Date.now()) {
  const leases = await loadLeases(
    supabase,
    rows.map((r) => r.submission_billing_record_id ?? "").filter(Boolean),
  );
  return splitCorrectedProcessing(rows, leases, now);
}

/** Badge counts: how many corrected copies are truly working vs on hold. */
export async function countCorrectedProcessing(
  supabase: Sb,
  companyId: string | null,
): Promise<{ processing: number; verification_hold: number }> {
  let q = supabase
    .from("claim_resubmissions")
    .select("id, submission_billing_record_id")
    .eq("status", "processing")
    .limit(1000);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  const split = await correctedProcessingSplit(supabase, (data ?? []) as any[]);
  return { processing: split.processing.length, verification_hold: split.verification_hold.length };
}
