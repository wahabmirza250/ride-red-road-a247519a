import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling, logAudit } from "@/lib/billingHelpers";
import { CLASSIFIER_VERSION, REVIEW_STATUSES } from "@/lib/destinationClassifier";
import {
  buildOverrideRow,
  runClassification,
  MAX_TRIPS_PER_RUN,
} from "@/lib/destinationReview.server";

/** Bill stages worth reviewing — anything already at the portal is left alone. */
const ACTIVE_STATUSES = ["pending_review", "approved", "needs_fix", "queued"] as const;

/**
 * Classify destinations for the company's active bills. Additive: it only
 * writes classification rows. Never submits, never edits a claim.
 */
export const classifyDestinationsForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(MAX_TRIPS_PER_RUN).optional(),
        /** Re-run even for trips already classified with this version. */
        refresh: z.boolean().optional(),
        trip_ids: z.array(z.string().uuid()).max(200).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    let q = supabase
      .from("billing_records")
      .select(
        `id, trip_id, company_id, status,
         medicaid_trips!inner(id, dropoff_address, pickup_at)`,
      )
      .limit(data.limit ?? MAX_TRIPS_PER_RUN);
    q = data.trip_ids?.length
      ? q.in("trip_id", data.trip_ids)
      : q.in("status", ACTIVE_STATUSES as unknown as string[]);
    const { data: bills, error } = await q;
    if (error) throw new Error(error.message);

    const tripIds = Array.from(new Set((bills ?? []).map((b: any) => b.trip_id)));
    let already = new Set<string>();
    if (!data.refresh && tripIds.length) {
      const { data: existing } = await supabase
        .from("trip_destination_classifications")
        .select("trip_id")
        .eq("classifier_version", CLASSIFIER_VERSION)
        .in("trip_id", tripIds);
      already = new Set((existing ?? []).map((r: any) => r.trip_id));
    }

    const trips = (bills ?? [])
      .filter((b: any) => !already.has(b.trip_id))
      .map((b: any) => ({
        trip_id: b.trip_id,
        company_id: b.company_id ?? null,
        destination: b.medicaid_trips?.dropoff_address ?? null,
        destination_name: b.medicaid_trips?.dropoff_facility_name ?? null,
      }));

    if (!trips.length) {
      return {
        classified: 0,
        lookups: 0,
        deferred_lookups: 0,
        places_configured: true,
        counts: {},
        version: CLASSIFIER_VERSION,
        skipped: already.size,
      };
    }

    const res = await runClassification(supabase, trips, {
      refreshKeys: data.refresh ? trips.map((t) => t.destination ?? "") : [],
    });
    return { ...res, skipped: already.size };
  });

/**
 * The "Needs medical review" list: flagged classifications joined to their
 * bills, with any override already recorded. Three bounded queries, no N+1.
 */
export const listDestinationReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        include_unknown: z.boolean().optional(),
        include_overridden: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const statuses = data.include_unknown
      ? REVIEW_STATUSES
      : REVIEW_STATUSES.filter((s) => s !== "unknown");

    const { data: cls, error } = await supabase
      .from("trip_destination_classifications")
      .select(
        "id, trip_id, status, confidence, summary, reasons, matched, evidence, destination_text, classifier_version, classified_at",
      )
      .eq("classifier_version", CLASSIFIER_VERSION)
      .in("status", statuses as unknown as string[])
      .order("classified_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const tripIds = Array.from(new Set((cls ?? []).map((c: any) => c.trip_id)));
    if (!tripIds.length) return [];

    const [{ data: bills }, { data: overrides }] = await Promise.all([
      supabase
        .from("billing_records")
        .select(
          `id, trip_id, status, submitted_at, updated_at,
           medicaid_trips!inner(id, pickup_at, pickup_address, dropoff_address, driver_id, paper_driver_name,
             riders(full_name, medicaid_id))`,
        )
        .in("trip_id", tripIds)
        .in("status", ACTIVE_STATUSES as unknown as string[]),
      supabase
        .from("destination_review_overrides")
        .select("id, trip_id, original_status, note, overridden_by, created_at")
        .in("trip_id", tripIds)
        .order("created_at", { ascending: false }),
    ]);

    const driverIds = Array.from(
      new Set((bills ?? []).map((b: any) => b.medicaid_trips?.driver_id).filter(Boolean)),
    );
    const overrideActorIds = Array.from(
      new Set((overrides ?? []).map((o: any) => o.overridden_by).filter(Boolean)),
    );
    const ids = Array.from(new Set([...driverIds, ...overrideActorIds]));
    let profiles: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      profiles = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p]));
    }
    const fullName = (id: string | null | undefined) =>
      id && profiles[id]
        ? `${profiles[id].first_name ?? ""} ${profiles[id].last_name ?? ""}`.trim() || null
        : null;

    const overrideByTrip = new Map<string, any>();
    for (const o of overrides ?? []) if (!overrideByTrip.has(o.trip_id)) overrideByTrip.set(o.trip_id, o);
    const clsByTrip = new Map<string, any>();
    for (const c of cls ?? []) clsByTrip.set(c.trip_id, c);

    return (bills ?? [])
      .map((b: any) => {
        const c = clsByTrip.get(b.trip_id);
        const ov = overrideByTrip.get(b.trip_id) ?? null;
        const trip = b.medicaid_trips ?? {};
        return {
          id: b.id,
          trip_id: b.trip_id,
          bill_status: b.status,
          submitted_at: b.submitted_at,
          updated_at: b.updated_at,
          passenger_name: trip.riders?.full_name ?? null,
          medicaid_id: trip.riders?.medicaid_id ?? null,
          driver_name:
            (trip.paper_driver_name?.trim() || null) ?? fullName(trip.driver_id) ?? "—",
          pickup_at: trip.pickup_at,
          pickup_address: trip.pickup_address,
          dropoff_address: trip.dropoff_address,
          classification_id: c?.id ?? null,
          classification_status: c?.status ?? "unknown",
          confidence: c?.confidence ?? null,
          summary: c?.summary ?? null,
          reasons: c?.reasons ?? [],
          matched: c?.matched ?? [],
          evidence: c?.evidence ?? {},
          classified_at: c?.classified_at ?? null,
          override: ov
            ? {
                original_status: ov.original_status,
                note: ov.note,
                at: ov.created_at,
                by: fullName(ov.overridden_by) ?? "Billing staff",
              }
            : null,
        };
      })
      .filter((r: any) => (data.include_overridden ? true : !r.override));
  });

/** Re-run classification for one trip. Claim fields are never touched. */
export const recheckTripDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: bill, error } = await supabase
      .from("billing_records")
      .select("id, trip_id, company_id, medicaid_trips!inner(dropoff_address)")
      .eq("trip_id", data.trip_id)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!bill) throw new Error("Bill not found");

    return runClassification(
      supabase,
      [
        {
          trip_id: bill.trip_id,
          company_id: bill.company_id ?? null,
          destination: (bill as any).medicaid_trips?.dropoff_address ?? null,
          destination_name: (bill as any).medicaid_trips?.dropoff_facility_name ?? null,
        },
      ],
      { refreshKeys: [(bill as any).medicaid_trips?.dropoff_address ?? ""] },
    );
  });

/**
 * "Send anyway to billing" — a deliberate biller override. It records who,
 * when, the original classification and an optional note, and clears the
 * review flag. It does NOT submit anything and does NOT call HCPF; the bill
 * simply continues through the normal workflow it was already in.
 */
export const overrideDestinationReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        billing_record_id: z.string().uuid(),
        note: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    // RLS scopes this read to the caller's company.
    const { data: bill, error } = await supabase
      .from("billing_records")
      .select("id, trip_id, company_id, status")
      .eq("id", data.billing_record_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!bill) throw new Error("Bill not found");

    const { data: cls } = await supabase
      .from("trip_destination_classifications")
      .select("id, status, summary")
      .eq("trip_id", bill.trip_id)
      .eq("classifier_version", CLASSIFIER_VERSION)
      .maybeSingle();

    const row = buildOverrideRow({
      trip_id: bill.trip_id,
      billing_record_id: bill.id,
      company_id: bill.company_id ?? null,
      classification: cls ?? null,
      note: data.note ?? null,
      actor_id: userId ?? null,
    });
    const { error: insErr } = await supabase.from("destination_review_overrides").insert(row);
    if (insErr) throw new Error(insErr.message);

    await logAudit(
      supabase,
      bill.id,
      userId ?? null,
      "destination_review_override",
      `Destination flagged "${row.original_status}" was sent on to billing by explicit override.${
        row.note ? ` Note: ${row.note}` : ""
      }`,
    );

    return { ok: true, bill_status: bill.status, original_status: row.original_status };
  });
