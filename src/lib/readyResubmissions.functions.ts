import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { READY_RESUBMISSION_STATUS, canRetryResubmission } from "@/lib/resubmissionLifecycle";

async function assertBiller(supabase: any, userId: string) {
  const [{ data: a }, { data: b }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin_biller" }),
  ]);
  if (!a && !b && !c) throw new Error("Forbidden: billing or admin only");
}

async function companyOf(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  return (data?.company_id as string | null) ?? null;
}

const SELECT = `id, company_id, original_trip_id, original_claim_number, original_status,
   original_denial_reason, idempotency_key, draft_version, submitted_at, status,
   resubmission_claim_number, failure_reason, draft_snapshot, original_snapshot`;

/** Load corrected cards for one or more lifecycle states. */
async function loadCorrected(
  supabase: any,
  companyId: string | null,
  statuses: string[],
  limit: number,
) {
  let q = supabase
    .from("claim_resubmissions")
    .select(SELECT)
    .in("status", statuses)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const subs = (rows ?? []) as any[];
  if (!subs.length) return { rows: [], total: 0 };

  const ids = subs.map((s) => s.id);
  const tripIds = [...new Set(subs.map((s) => s.original_trip_id).filter(Boolean))];
  const [{ data: lines }, { data: trips }, { data: rates }] = await Promise.all([
    supabase
      .from("claim_service_lines")
      .select("resubmission_id, line_index, modifiers")
      .in("resubmission_id", ids),
    tripIds.length
      ? supabase.from("medicaid_trips").select("id, state_pdf_path").in("id", tripIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("billing_rate_settings")
      .select(
        "id, provider_id, vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
      )
      .is("company_id", null),
  ]);

  const pdfOf = new Map(((trips ?? []) as any[]).map((t) => [t.id, t.state_pdf_path]));
  const { buildCorrectedCandidate, dedupeCorrected } = await import("@/lib/readyResubmissions");
  const cards = dedupeCorrected(
    subs.map((row) =>
      buildCorrectedCandidate({
        row,
        lines: (lines ?? []) as any[],
        rates: (rates ?? []) as any[],
        tripPdfPath: pdfOf.get(row.original_trip_id) ?? null,
      }),
    ),
  );
  return { rows: cards, total: cards.length };
}

/**
 * READY TO SUBMIT — corrected resubmissions.
 *
 * `claim_resubmissions.status = 'queued'` IS the ready state: saved, validated
 * and waiting for the owner to press Auto Pilot. The moment Auto Pilot claims
 * a row it becomes `processing` and disappears from here, so it can never be
 * selected or sent twice.
 */
export const listReadyResubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);
    return await loadCorrected(
      supabase,
      companyId,
      [READY_RESUBMISSION_STATUS],
      data.limit ?? 200,
    );
  });

/**
 * Corrected claims in a NON-ready state:
 *   processing — handed to the robot, blocked from Ready and from any retry
 *   failed     — definitely not sent, waiting for an explicit owner decision
 *   submitted/paid/denied — the NEW claim exists
 */
export const listResubmissionsByStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        stage: z.enum(["processing", "failed", "submitted", "settled"]),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);
    const statuses =
      data.stage === "settled" ? ["paid", "denied"] : data.stage === "submitted" ? ["submitted"] : [data.stage];
    return await loadCorrected(supabase, companyId, statuses, data.limit ?? 200);
  });

/** Badge counts for the corrected lifecycle — same scope as the lists. */
export const countReadyResubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);
    const count = async (status: string) => {
      let q = supabase
        .from("claim_resubmissions")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (companyId) q = q.eq("company_id", companyId);
      const { count: n, error } = await q;
      if (error) throw new Error(error.message);
      return Number(n ?? 0);
    };
    const [ready, processing, failed] = await Promise.all([
      count("queued"),
      count("processing"),
      count("failed"),
    ]);
    return {
      corrected_ready: ready,
      corrected_processing: processing,
      corrected_failed: failed,
    };
  });

/**
 * EXPLICIT owner retry of a corrected claim that definitely never reached the
 * portal: failed -> queued. Idempotent — a second click finds no `failed` row
 * and changes nothing. Uncertain outcomes are `processing`, never `failed`,
 * so they can never be retried through this path.
 */
export const retryFailedResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);

    const { data: row } = await supabase
      .from("claim_resubmissions")
      .select("id, company_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("This corrected claim no longer exists.");
    if (!canRetryResubmission(row.status)) {
      return {
        moved: false,
        reason: `This corrected claim is ${row.status} — only a failed corrected claim can be moved back to Ready to Submit.`,
      };
    }

    const { data: updated } = await supabase
      .from("claim_resubmissions")
      .update({
        status: "queued",
        failure_reason: null,
        claimed_at: null,
        claimed_by: null,
        submission_billing_record_id: null,
      })
      .eq("id", data.id)
      .eq("status", "failed")
      .select("id");
    if (!updated || !updated.length) return { moved: false, reason: "Nothing to move." };

    const { writeResubmissionEvent } = await import("@/lib/resubmissionLifecycle.server");
    await writeResubmissionEvent(supabase, {
      resubmission_id: data.id,
      company_id: row.company_id ?? null,
      actor_id: userId,
      action: "resubmission_retry_requested",
      notes:
        "Owner moved this failed corrected claim back to Ready to Submit. Nothing is sent until " +
        "Auto Pilot is started again.",
    });
    return { moved: true, reason: "" };
  });
