import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertEditableResubmission, diffModifiers, MAX_MODIFIERS_PER_LINE } from "@/lib/claimModifiers";

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

/** Denied / rejected claims eligible for a resubmission draft. */
export const listDeniedClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ page: z.number().int().min(0).default(0), page_size: z.number().int().min(10).max(200).default(50) }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    let q = supabase
      .from("billing_records")
      .select("id, trip_id, status, state_confirmation_number, submission_error, updated_at, company_id", {
        count: "exact",
      })
      .in("status", ["denied", "rejected"]);
    if (companyId) q = q.eq("company_id", companyId);

    const start = data.page * data.page_size;
    const { data: recs, error, count } = await q
      .order("updated_at", { ascending: false })
      .range(start, start + data.page_size - 1);
    if (error) throw new Error(error.message);

    const ids = ((recs ?? []) as any[]).map((r) => r.trip_id);
    const [{ data: trips }, { data: subs }] = await Promise.all([
      ids.length
        ? supabase
            .from("medicaid_trips")
            .select("id, pickup_at, paper_driver_name, robot_confirmation_number, submitted_confirmation, riders(full_name, medicaid_id)")
            .in("id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? supabase.from("claim_resubmissions").select("id, original_trip_id, status").in("original_trip_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const tripOf = new Map(((trips ?? []) as any[]).map((t) => [t.id, t]));
    const subOf = new Map(((subs ?? []) as any[]).map((s) => [s.original_trip_id, s]));

    return {
      total: count ?? 0,
      rows: ((recs ?? []) as any[]).map((r) => {
        const t = tripOf.get(r.trip_id);
        const sub = subOf.get(r.trip_id);
        return {
          trip_id: r.trip_id as string,
          claim_status: r.status as string,
          claim_number:
            r.state_confirmation_number ?? t?.robot_confirmation_number ?? t?.submitted_confirmation ?? null,
          denial_reason: (r.submission_error as string | null) ?? null,
          trip_date: t?.pickup_at ?? null,
          passenger: t?.riders?.full_name ?? null,
          medicaid_id: t?.riders?.medicaid_id ?? null,
          driver_name: t?.paper_driver_name ?? null,
          resubmission_id: (sub?.id as string | undefined) ?? null,
          resubmission_status: (sub?.status as string | undefined) ?? null,
        };
      }),
    };
  });

/**
 * Create a resubmission DRAFT linked to a denied claim.
 * The original claim row, its HCPF claim number and its denial history are
 * never modified. The partial unique index guarantees only one live draft per
 * original claim, so two billers or a double click collapse onto one row.
 */
export const prepareResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const { data: existing } = await supabase
      .from("claim_resubmissions")
      .select("id, status")
      .eq("original_trip_id", data.trip_id)
      .in("status", ["draft", "queued"])
      .maybeSingle();
    if (existing) return { id: existing.id as string, created: false };

    const [{ data: trip }, { data: rec }] = await Promise.all([
      supabase
        .from("medicaid_trips")
        .select(
          "id, company_id, pickup_at, miles, trip_kind, robot_confirmation_number, submitted_confirmation, status",
        )
        .eq("id", data.trip_id)
        .maybeSingle(),
      supabase
        .from("billing_records")
        .select("status, submission_error, state_confirmation_number")
        .eq("trip_id", data.trip_id)
        .maybeSingle(),
    ]);
    if (!trip) throw new Error("Claim not found.");

    const { data: created, error } = await supabase
      .from("claim_resubmissions")
      .insert({
        company_id: trip.company_id ?? companyId,
        original_trip_id: trip.id,
        original_claim_number:
          rec?.state_confirmation_number ?? trip.robot_confirmation_number ?? trip.submitted_confirmation ?? null,
        original_denial_reason: rec?.submission_error ?? null,
        original_status: rec?.status ?? trip.status ?? null,
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) {
      // Lost the race against another biller — return their draft.
      const { data: raced } = await supabase
        .from("claim_resubmissions")
        .select("id")
        .eq("original_trip_id", data.trip_id)
        .in("status", ["draft", "queued"])
        .maybeSingle();
      if (raced) return { id: raced.id as string, created: false };
      throw new Error(error.message);
    }

    // Seed one service line per leg so the biller edits real lines, never the
    // original claim. Modifiers start EMPTY — 76 is never auto-applied.
    const { data: legs } = await supabase
      .from("medicaid_trip_legs")
      .select("leg_index, pickup_odometer, dropoff_odometer")
      .eq("medicaid_trip_id", trip.id)
      .order("leg_index");
    const lines = ((legs ?? []) as any[]).length ? (legs as any[]) : [{ leg_index: 1 }];
    await supabase.from("claim_service_lines").insert(
      lines.map((l: any, i: number) => ({
        company_id: trip.company_id ?? companyId,
        resubmission_id: created.id,
        trip_id: trip.id,
        line_index: Number(l.leg_index ?? i + 1),
        service_date: trip.pickup_at ? String(trip.pickup_at).slice(0, 10) : null,
        units: 1,
        miles:
          l.dropoff_odometer != null && l.pickup_odometer != null
            ? Math.max(0, Number(l.dropoff_odometer) - Number(l.pickup_odometer))
            : (trip.miles ?? null),
        modifiers: [],
      })),
    );
    return { id: created.id as string, created: true };
  });

/** Full draft, its service lines and the modifier audit trail. */
export const getResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const { data: sub, error } = await supabase
      .from("claim_resubmissions")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Resubmission not found.");
    const [{ data: lines }, { data: audit }] = await Promise.all([
      supabase.from("claim_service_lines").select("*").eq("resubmission_id", data.id).order("line_index"),
      supabase
        .from("claim_modifier_audit")
        .select("*")
        .eq("resubmission_id", data.id)
        .order("created_at", { ascending: false }),
    ]);
    return { resubmission: sub as any, lines: (lines ?? []) as any[], audit: (audit ?? []) as any[] };
  });

/** Save modifiers for ONE service line of a draft, with a full audit entry. */
export const setServiceLineModifiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        line_id: z.string().uuid(),
        modifiers: z.array(z.string().min(1).max(4)).max(MAX_MODIFIERS_PER_LINE),
        reason: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const { data: line, error } = await supabase
      .from("claim_service_lines")
      .select("id, resubmission_id, modifiers")
      .eq("id", data.line_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!line) throw new Error("Service line not found.");

    const { data: sub } = await supabase
      .from("claim_resubmissions")
      .select("status")
      .eq("id", line.resubmission_id)
      .maybeSingle();
    assertEditableResubmission(sub?.status);

    const before = ((line.modifiers ?? []) as string[]).map((m) => m.toUpperCase());
    const after = [...new Set(data.modifiers.map((m) => m.trim().toUpperCase()).filter(Boolean))];
    const entries = diffModifiers(before, after, data.reason ?? null);

    const { error: upErr } = await supabase
      .from("claim_service_lines")
      .update({ modifiers: after })
      .eq("id", data.line_id);
    if (upErr) throw new Error(upErr.message);

    if (entries.length) {
      await supabase.from("claim_modifier_audit").insert(
        entries.map((e) => ({
          company_id: companyId,
          service_line_id: data.line_id,
          resubmission_id: line.resubmission_id,
          action: e.action,
          modifier: e.modifier,
          reason: e.reason,
          actor_id: userId,
        })),
      );
    }
    return { modifiers: after, changes: entries.length };
  });

/**
 * Hand the reviewed draft to the EXISTING account-scoped submission queue.
 * No queue behaviour changes here: this only marks the draft queued and
 * re-queues the underlying billing record through the normal path.
 */
export const queueResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);

    // Idempotent: only a draft may transition, so a second click is a no-op.
    const { data: moved, error } = await supabase
      .from("claim_resubmissions")
      .update({ status: "queued", submitted_by: userId, submitted_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "draft")
      .select("id, original_trip_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!moved) return { queued: false, reason: "Already queued or submitted." };

    return { queued: true, trip_id: moved.original_trip_id as string };
  });

/** Cancel a draft so the denial can be reworked later. */
export const cancelResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const { error } = await supabase
      .from("claim_resubmissions")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
