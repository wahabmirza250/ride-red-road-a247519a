import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertEditableResubmission, diffModifiers, MAX_MODIFIERS_PER_LINE } from "@/lib/claimModifiers";
import {
  buildSnapshotFromTrip,
  diffSnapshots,
  canQueueDraft,
  effectiveMiles,
  normalizeSnapshot,
  validateDraft,
  type DraftSnapshot,
} from "@/lib/resubmissionDraft";

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

/** Immutable audit event for every draft action. Never blocks the action. */
async function recordEvent(
  supabase: any,
  args: {
    resubmissionId: string;
    companyId: string | null;
    actorId: string;
    action: string;
    changes?: unknown;
    notes?: string | null;
  },
) {
  const { error } = await supabase.from("claim_resubmission_events").insert({
    resubmission_id: args.resubmissionId,
    company_id: args.companyId,
    actor_id: args.actorId,
    action: args.action,
    changes: args.changes ?? [],
    notes: args.notes ?? null,
  });
  if (error)
    throw new Error(
      `The ${args.action.replace(/_/g, " ")} could not be recorded in the audit trail, so it was not completed: ${error.message}`,
    );
}

/** Load the draft and prove the caller's company owns it. */
async function loadOwnedDraft(supabase: any, userId: string, id: string) {
  const { data: sub, error } = await supabase
    .from("claim_resubmissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!sub) throw new Error("Resubmission not found.");
  const companyId = await companyOf(supabase, userId);
  if (companyId && sub.company_id && sub.company_id !== companyId)
    throw new Error("Forbidden: this resubmission belongs to another company.");
  return sub as any;
}

const legSchema = z.object({
  leg_index: z.number().int().min(1),
  leg_date: z.string().nullable().optional(),
  pickup_time: z.string().nullable().optional(),
  pickup_address: z.string().nullable().optional(),
  pickup_odometer: z.number().nullable().optional(),
  dropoff_time: z.string().nullable().optional(),
  dropoff_address: z.string().nullable().optional(),
  dropoff_odometer: z.number().nullable().optional(),
});

const lineSchema = z.object({
  line_index: z.number().int().min(1),
  service_date: z.string().nullable().optional(),
  procedure_code: z.string().nullable().optional(),
  place_of_service: z.string().nullable().optional(),
  diagnosis_code: z.string().nullable().optional(),
  units: z.number().nullable().optional(),
  miles: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  modifiers: z.array(z.string()).max(MAX_MODIFIERS_PER_LINE).optional(),
});

const snapshotSchema = z.object({
  service_date: z.string().nullable().optional(),
  rider_id: z.string().nullable().optional(),
  passenger_name: z.string().nullable().optional(),
  medicaid_id: z.string().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  vehicle_type: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  vehicle_vin: z.string().nullable().optional(),
  trip_kind: z.string().nullable().optional(),
  escort_name: z.string().nullable().optional(),
  identity_verified: z.boolean().optional(),
  signed_by_escort: z.boolean().optional(),
  signature_on_file: z.boolean().optional(),
  state_pdf_path: z.string().nullable().optional(),
  miles_override: z.number().nullable().optional(),
  miles_override_reason: z.string().nullable().optional(),
  correction_reason: z.string().nullable().optional(),
  legs: z.array(legSchema).max(12),
  lines: z.array(lineSchema).max(24),
});

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

const TRIP_SNAPSHOT_SELECT = `id, company_id, pickup_at, pickup_address, dropoff_address,
  odometer_start, odometer_end, miles, trip_kind, vehicle_type, vehicle_plate, vehicle_vin,
  escort_name, identity_verified, signed_by_escort, signature_path, state_pdf_path,
  driver_id, rider_id, paper_driver_name, robot_confirmation_number, submitted_confirmation, status,
  riders(full_name, medicaid_id)`;

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
      supabase.from("medicaid_trips").select(TRIP_SNAPSHOT_SELECT).eq("id", data.trip_id).maybeSingle(),
      supabase
        .from("billing_records")
        .select("status, submission_error, state_confirmation_number")
        .eq("trip_id", data.trip_id)
        .maybeSingle(),
    ]);
    if (!trip) throw new Error("Claim not found.");
    if (companyId && trip.company_id && trip.company_id !== companyId)
      throw new Error("Forbidden: this claim belongs to another company.");

    const { data: legs } = await supabase
      .from("medicaid_trip_legs")
      .select("leg_index, leg_date, pickup_time, pickup_address, pickup_odometer, dropoff_time, dropoff_address, dropoff_odometer")
      .eq("medicaid_trip_id", trip.id)
      .order("leg_index");

    let driverName: string | null = trip.paper_driver_name ?? null;
    if (!driverName && trip.driver_id) {
      const { data: drv } = await supabase
        .from("drivers")
        .select("user_id")
        .eq("id", trip.driver_id)
        .maybeSingle();
      if (drv?.user_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", drv.user_id)
          .maybeSingle();
        driverName =
          [prof?.first_name, prof?.last_name].filter(Boolean).join(" ").trim() || null;
      }
    }

    const baseSnapshot = buildSnapshotFromTrip({
      trip,
      legs: (legs ?? []) as any[],
      rider: trip.riders,
      driverName,
    });
    // Seed one service line per leg. Modifiers start EMPTY — 76 is never auto-applied.
    const seededLines = baseSnapshot.legs.map((l, i) => ({
      line_index: l.leg_index || i + 1,
      service_date: l.leg_date ?? baseSnapshot.service_date,
      procedure_code: null,
      place_of_service: null,
      diagnosis_code: null,
      units: 1,
      miles: Math.max(0, Number(l.dropoff_odometer ?? 0) - Number(l.pickup_odometer ?? 0)) || null,
      amount: null,
      modifiers: [] as string[],
    }));
    const snapshot = normalizeSnapshot({ ...baseSnapshot, lines: seededLines });

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
        original_snapshot: snapshot as any,
        draft_snapshot: snapshot as any,
        draft_version: 1,
        last_saved_at: new Date().toISOString(),
        last_saved_by: userId,
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

    await supabase.from("claim_service_lines").insert(
      snapshot.lines.map((l) => ({
        company_id: trip.company_id ?? companyId,
        resubmission_id: created.id,
        trip_id: trip.id,
        line_index: l.line_index,
        service_date: l.service_date,
        procedure_code: l.procedure_code,
        place_of_service: l.place_of_service,
        diagnosis_code: l.diagnosis_code,
        units: l.units,
        miles: l.miles,
        amount: l.amount,
        modifiers: l.modifiers,
      })),
    );

    await recordEvent(supabase, {
      resubmissionId: created.id as string,
      companyId: trip.company_id ?? companyId,
      actorId: userId,
      action: "draft_created",
      notes: "Draft cloned from the original trip. The original claim is untouched.",
    });
    return { id: created.id as string, created: true };
  });

/** Full draft, its service lines, the modifier audit and the event trail. */
export const getResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const sub = await loadOwnedDraft(supabase, userId, data.id);

    const [{ data: lines }, { data: audit }, { data: events }, { data: trip }] = await Promise.all([
      supabase.from("claim_service_lines").select("*").eq("resubmission_id", data.id).order("line_index"),
      supabase
        .from("claim_modifier_audit")
        .select("*")
        .eq("resubmission_id", data.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("claim_resubmission_events")
        .select("*")
        .eq("resubmission_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("medicaid_trips").select(TRIP_SNAPSHOT_SELECT).eq("id", sub.original_trip_id).maybeSingle(),
    ]);

    const { data: legs } = trip
      ? await supabase
          .from("medicaid_trip_legs")
          .select("leg_index, leg_date, pickup_time, pickup_address, pickup_odometer, dropoff_time, dropoff_address, dropoff_odometer")
          .eq("medicaid_trip_id", trip.id)
          .order("leg_index")
      : { data: [] as any[] };

    // Legacy drafts created before full-draft support have no snapshot yet:
    // rebuild it from the untouched original so they reopen fully editable.
    const original =
      sub.original_snapshot ??
      (trip
        ? buildSnapshotFromTrip({
            trip,
            legs: (legs ?? []) as any[],
            lines: (lines ?? []) as any[],
            rider: trip.riders,
            driverName: trip.paper_driver_name ?? null,
          })
        : null);
    const draft = sub.draft_snapshot ?? original;

    // Drivers list for the editor's driver picker (company-scoped by RLS).
    // public.drivers has NO full_name column — the display name lives on the
    // linked profile, so read id + user_id and derive the label here.
    const drivers = await listCompanyDrivers(supabase, sub.company_id);

    return {
      resubmission: sub,
      lines: (lines ?? []) as any[],
      audit: (audit ?? []) as any[],
      events: (events ?? []) as any[],
      original_snapshot: original ? normalizeSnapshot(original) : null,
      draft_snapshot: draft ? normalizeSnapshot(draft) : null,
      drivers: (drivers ?? []) as any[],
    };
  });

/** Save (never submit) the corrected draft snapshot and its service lines. */
export const saveResubmissionDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), snapshot: snapshotSchema }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const sub = await loadOwnedDraft(supabase, userId, data.id);
    assertEditableResubmission(sub.status);

    const next = normalizeSnapshot(data.snapshot);
    const previous = normalizeSnapshot(sub.draft_snapshot ?? sub.original_snapshot ?? {});
    const changes = diffSnapshots(previous, next);
    const version = Number(sub.draft_version ?? 1) + (changes.length ? 1 : 0);

    const { error: upErr } = await supabase
      .from("claim_resubmissions")
      .update({
        draft_snapshot: next as any,
        draft_version: version,
        correction_reason: next.correction_reason,
        mileage_override_reason: next.miles_override_reason,
        notes: next.correction_reason,
        last_saved_at: new Date().toISOString(),
        last_saved_by: userId,
      })
      .eq("id", data.id)
      .eq("status", "draft");
    if (upErr) throw new Error(upErr.message);

    // Mirror the snapshot's lines into claim_service_lines so the payload
    // builder and the modifier audit keep a normalized source of truth.
    const { data: existingLines } = await supabase
      .from("claim_service_lines")
      .select("id, line_index, modifiers")
      .eq("resubmission_id", data.id);
    const byIndex = new Map(((existingLines ?? []) as any[]).map((l) => [Number(l.line_index), l]));

    for (const line of next.lines) {
      const row = {
        company_id: sub.company_id,
        resubmission_id: data.id,
        trip_id: sub.original_trip_id,
        line_index: line.line_index,
        service_date: line.service_date,
        procedure_code: line.procedure_code,
        place_of_service: line.place_of_service,
        diagnosis_code: line.diagnosis_code,
        units: line.units,
        miles: line.miles,
        amount: line.amount,
        modifiers: line.modifiers,
      };
      const existing = byIndex.get(line.line_index);
      if (existing) {
        await supabase.from("claim_service_lines").update(row).eq("id", existing.id);
        const entries = diffModifiers(
          ((existing.modifiers ?? []) as string[]).map((m) => m.toUpperCase()),
          line.modifiers,
          next.correction_reason,
        );
        if (entries.length)
          await supabase.from("claim_modifier_audit").insert(
            entries.map((e) => ({
              company_id: sub.company_id,
              service_line_id: existing.id,
              resubmission_id: data.id,
              action: e.action,
              modifier: e.modifier,
              reason: e.reason,
              actor_id: userId,
            })),
          );
        byIndex.delete(line.line_index);
      } else {
        await supabase.from("claim_service_lines").insert(row);
      }
    }
    // Lines removed by the biller (e.g. round trip -> one way).
    for (const stale of byIndex.values()) {
      await supabase.from("claim_service_lines").delete().eq("id", stale.id);
    }

    await recordEvent(supabase, {
      resubmissionId: data.id,
      companyId: sub.company_id,
      actorId: userId,
      action: "draft_saved",
      changes,
      notes: next.correction_reason,
    });

    const validation = validateDraft(next);
    return {
      saved: true,
      version,
      changes,
      total_miles: effectiveMiles(next),
      validation,
    };
  });

/** Review step: records that the biller reviewed and returns the full diff. */
export const reviewResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const sub = await loadOwnedDraft(supabase, userId, data.id);
    const draft = normalizeSnapshot(sub.draft_snapshot ?? {}) as DraftSnapshot;
    const original = normalizeSnapshot(sub.original_snapshot ?? {});
    const changes = diffSnapshots(original, draft);
    const validation = validateDraft(draft);
    await recordEvent(supabase, {
      resubmissionId: data.id,
      companyId: sub.company_id,
      actorId: userId,
      action: "draft_reviewed",
      changes,
    });
    return { changes, validation, total_miles: effectiveMiles(draft) };
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
 * Never automatic: the caller must pass an explicit confirmation. The original
 * claim number is never reused — the queue mints a fresh idempotency key.
 */
export const queueResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), confirm: z.literal(true) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const sub = await loadOwnedDraft(supabase, userId, data.id);

    const draft = normalizeSnapshot(sub.draft_snapshot ?? {});
    const gate = canQueueDraft(sub, draft, data.confirm === true);
    if (!gate.ok) return { queued: false, reason: gate.reason, validation: validateDraft(draft) };

    const { data: rec } = await supabase
      .from("billing_records")
      .select("id, company_id, submit_idempotency_key")
      .eq("trip_id", sub.original_trip_id)
      .maybeSingle();
    if (!rec) throw new Error("The billing record for this claim no longer exists.");

    const { buildIdempotencyKey, versionOfKey } = await import("@/lib/submissionIdempotency");
    const idempotencyKey = buildIdempotencyKey({
      accountKey: null,
      companyId: sub.company_id ?? rec.company_id ?? null,
      tripId: sub.original_trip_id,
      serviceDate: draft.service_date,
      version: versionOfKey(rec.submit_idempotency_key ?? null) + 1,
    });

    // Idempotent: only a draft may transition, so a second click is a no-op.
    const { data: moved, error } = await supabase
      .from("claim_resubmissions")
      .update({
        status: "queued",
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      })
      .eq("id", data.id)
      .eq("status", "draft")
      .select("id, original_trip_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!moved) return { queued: false, reason: "Already queued or submitted." };

    await recordEvent(supabase, {
      resubmissionId: data.id,
      companyId: sub.company_id,
      actorId: userId,
      action: "draft_queued",
      changes: diffSnapshots(sub.original_snapshot ?? {}, draft),
      notes: `Explicitly queued for HCPF with key ${idempotencyKey}. Original claim ${sub.original_claim_number ?? "n/a"} untouched.`,
    });

    return { queued: true, trip_id: moved.original_trip_id as string, idempotency_key: idempotencyKey };
  });

/** Discard a draft so the denial can be reworked later. Original untouched. */
export const discardResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBiller(supabase, userId);
    const sub = await loadOwnedDraft(supabase, userId, data.id);
    const { error } = await supabase
      .from("claim_resubmissions")
      .update({ status: "cancelled", discarded_at: new Date().toISOString(), discarded_by: userId })
      .eq("id", data.id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    await recordEvent(supabase, {
      resubmissionId: data.id,
      companyId: sub.company_id,
      actorId: userId,
      action: "draft_discarded",
      notes: "Draft discarded. The original denied claim is unchanged.",
    });
    return { ok: true };
  });

/** Backwards-compatible alias. */
export const cancelResubmission = discardResubmission;
