import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

/**
 * READY TO SUBMIT — corrected resubmissions.
 *
 * `claim_resubmissions.status = 'queued'` IS the ready state: saved, validated
 * and waiting for the owner to press Auto Pilot. Nothing here is submitted and
 * no original trip/claim row is read for the numbers — the card is rendered
 * from the corrected snapshot and its synchronized service lines.
 *
 * Company scope is applied explicitly on top of RLS.
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

    let q = supabase
      .from("claim_resubmissions")
      .select(
        `id, company_id, original_trip_id, original_claim_number, original_status,
         original_denial_reason, idempotency_key, draft_version, submitted_at, status,
         draft_snapshot, original_snapshot`,
      )
      .eq("status", "queued")
      .order("submitted_at", { ascending: false })
      .limit(data.limit ?? 200);
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
        .eq("company_id", companyId ?? subs[0].company_id),
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
  });

/** Badge count for the Ready stage — same predicate/scope as the list. */
export const countReadyResubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);
    let q = supabase
      .from("claim_resubmissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");
    if (companyId) q = q.eq("company_id", companyId);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { corrected_ready: Number(count ?? 0) };
  });
