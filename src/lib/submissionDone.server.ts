/**
 * DONE / COMPLETED FEED + LIVE QUEUE COUNTERS (server-only, read-only).
 *
 * Purely a projection of existing `billing_records` state: nothing here writes,
 * dispatches or touches the portal. RLS on the caller's client decides which
 * company's rows come back, so a biller only ever sees their own scope.
 */
import type { DoneClaim } from "@/lib/submissionThroughput";

export type QueueCounters = {
  queued: number;
  processing: number;
  verifying: number;
  needs_attention: number;
  done: number;
};

export type DoneFeed = {
  counters: QueueCounters;
  claims: DoneClaim[];
  /** Completion timestamps used for throughput, newest last. */
  completions: string[];
};

const DONE_STATUSES = ["submitted", "paid", "approved"];

export async function getDoneFeed(
  supabase: any,
  opts: { limit?: number } = {},
): Promise<DoneFeed> {
  const limit = Math.min(500, Math.max(20, opts.limit ?? 200));

  const [{ data: doneRows }, { data: activeRows }] = await Promise.all([
    supabase
      .from("billing_records")
      .select(
        "id, trip_id, status, state_confirmation_number, submitted_at, updated_at, submit_batch_id, medicaid_trips(paper_patient_name)",
      )
      .in("status", DONE_STATUSES)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from("billing_records")
      .select("id, status, requires_human_step")
      .in("status", ["queued", "submitting", "needs_fix"]),
  ]);

  const active = activeRows ?? [];
  const verifying = active.filter(
    (r: any) => r.status === "needs_fix" && r.requires_human_step,
  ).length;
  const counters: QueueCounters = {
    queued: active.filter((r: any) => r.status === "queued").length,
    processing: active.filter((r: any) => r.status === "submitting").length,
    verifying,
    needs_attention: Math.max(
      0,
      active.filter((r: any) => r.status === "needs_fix").length - verifying,
    ),
    done: (doneRows ?? []).length,
  };

  // Batch label + biller name, resolved in one extra round trip.
  const batchIds = [
    ...new Set((doneRows ?? []).map((r: any) => r.submit_batch_id).filter(Boolean)),
  ] as string[];
  const batchById = new Map<string, { label: string | null; created_by: string | null }>();
  if (batchIds.length > 0) {
    const { data: batches } = await supabase
      .from("submission_batches")
      .select("id, label, created_by")
      .in("id", batchIds);
    for (const b of batches ?? []) {
      batchById.set(b.id, { label: b.label ?? null, created_by: b.created_by ?? null });
    }
  }

  const billerIds = [
    ...new Set([...batchById.values()].map((b) => b.created_by).filter(Boolean)),
  ] as string[];
  const billerById = new Map<string, string>();
  if (billerIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", billerIds);
    for (const p of people ?? []) {
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
      if (name) billerById.set(p.id, name);
    }
  }

  const claims: DoneClaim[] = (doneRows ?? []).map((r: any) => {
    const batch = r.submit_batch_id ? batchById.get(r.submit_batch_id) : undefined;
    return {
      id: r.id as string,
      tripId: r.trip_id ?? null,
      status: String(r.status),
      claimId: r.state_confirmation_number ?? null,
      completedAt: r.submitted_at ?? r.updated_at ?? null,
      batchId: r.submit_batch_id ?? null,
      batchLabel: batch?.label ?? null,
      biller: batch?.created_by ? (billerById.get(batch.created_by) ?? null) : null,
      passenger: r.medicaid_trips?.paper_patient_name ?? null,
    };
  });

  const completions = claims
    .map((c) => c.completedAt)
    .filter((v): v is string => Boolean(v))
    .sort();

  return { counters, claims, completions };
}
