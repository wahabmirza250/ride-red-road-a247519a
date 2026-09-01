/**
 * Super EDI data access.
 *
 * READ-ONLY over the existing billing data (billing_records + medicaid_trips),
 * plus one narrow writer that persists the EDI identifiers returned by the EDI
 * backend onto the already-present `edi_*` columns of `billing_records`.
 *
 * Nothing here touches the HCPF/robot submission path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function guard(supabase: any, userId: string): Promise<string> {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);
  const { requireCompanyId } = await import("@/lib/company.server");
  return requireCompanyId(userId);
}

export type EdiCandidate = {
  id: string;
  trip_id: string;
  status: string;
  service_date: string | null;
  member_name: string | null;
  medicaid_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  edi_claim_id: number | null;
  edi_status: string | null;
};

const CANDIDATE_SELECT = `id, trip_id, status, edi_claim_id, edi_status,
  medicaid_trips!inner(id, pickup_at, pickup_address, dropoff_address,
    riders(full_name, medicaid_id))`;

/** Electronic trips already in the app that can be billed through EDI. */
export const listEdiCandidateRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        search: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        linked_only: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<EdiCandidate[]> => {
    const { supabase, userId } = context;
    await guard(supabase, userId);

    let q = supabase
      .from("billing_records")
      .select(CANDIDATE_SELECT)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.linked_only) q = q.not("edi_claim_id", "is", null);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const term = (data.search ?? "").toLowerCase().trim();
    return (rows ?? [])
      .map((r: any): EdiCandidate => {
        const trip = r.medicaid_trips ?? {};
        const rider = trip.riders ?? {};
        return {
          id: r.id,
          trip_id: r.trip_id,
          status: r.status,
          service_date: trip.pickup_at ?? null,
          member_name: rider.full_name ?? null,
          medicaid_id: rider.medicaid_id ?? null,
          pickup_address: trip.pickup_address ?? null,
          dropoff_address: trip.dropoff_address ?? null,
          edi_claim_id: r.edi_claim_id ?? null,
          edi_status: r.edi_status ?? null,
        };
      })
      .filter((c) =>
        !term
          ? true
          : [c.member_name, c.medicaid_id, c.pickup_address, c.dropoff_address]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(term)),
      );
  });

export type EdiServiceLine = {
  label: string;
  procedure_code: string | null;
  modifiers: string[];
  units: number;
  unit_word: string;
  rate: number;
  amount: number;
};

export type EdiTripDetail = {
  record_id: string;
  trip_id: string;
  status: string;
  member: {
    name: string | null;
    medicaid_id: string | null;
    dob: string | null;
    address: string | null;
    phone: string | null;
  };
  trip: {
    service_date: string | null;
    trip_kind: string | null;
    vehicle_type: string | null;
    pickup_address: string | null;
    dropoff_address: string | null;
    miles: number;
    long_distance: boolean;
    has_signed_form: boolean;
  };
  lines: EdiServiceLine[];
  total_charge: number;
  diagnosis_code: string | null;
  missing_rates: string[];
  provider: {
    billing_name: string | null;
    npi: string | null;
    taxonomy_code: string | null;
    configured: boolean;
  };
  edi: {
    edi_claim_id: number | null;
    edi_batch_id: number | null;
    edi_file_id: number | null;
    edi_status: string | null;
    edi_validation: Record<string, unknown> | null;
    edi_last_sync_at: string | null;
    edi_last_error: string | null;
  };
};

/** Colorado NEMT treats >50 billed miles as long distance (documentation). */
const LONG_DISTANCE_MILES = 50;

/** Everything Review Billing needs for one bill — member, trip, lines, provider. */
export const getEdiTripDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ record_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EdiTripDetail> => {
    const { supabase, userId } = context;
    const companyId = await guard(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, trip_id, status, edi_claim_id, edi_batch_id, edi_file_id, edi_status,
         edi_validation, edi_last_sync_at, edi_last_error,
         medicaid_trips!inner(id, pickup_at, pickup_address, dropoff_address, miles,
           odometer_start, odometer_end, trip_kind, vehicle_type, state_pdf_path,
           signature_path, company_id,
           riders(full_name, medicaid_id, dob, address, phone),
           medicaid_trip_legs(leg_index, leg_date, pickup_odometer, dropoff_odometer,
             pickup_address, dropoff_address, pickup_time, dropoff_time))`,
      )
      .eq("id", data.record_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Billing record not found");

    const trip: any = (rec as any).medicaid_trips ?? {};
    const rider: any = trip.riders ?? {};
    const vehicleType = String(trip.vehicle_type ?? "ambulatory");

    const { data: rateRows } = await supabase
      .from("billing_rate_settings")
      .select(
        "vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
      )
      .eq("company_id", companyId)
      .eq("vehicle_type", vehicleType);

    const { calcClaim } = await import("@/lib/claimCalc");
    const { normalizeTripLegs } = await import("@/lib/billingHelpers");
    const legs = normalizeTripLegs(trip).map((l) => ({
      pickup_odometer: l.pickup_odometer,
      dropoff_odometer: l.dropoff_odometer,
    }));
    const calc = calcClaim({
      legs,
      rates: (rateRows ?? []) as any,
      vehicleType,
    });

    const { data: setup } = await supabase
      .from("edi_company_settings")
      .select("billing_name, npi, taxonomy_code")
      .eq("company_id", companyId)
      .maybeSingle();

    const miles = calc.miles || Number(trip.miles ?? 0);

    return {
      record_id: (rec as any).id,
      trip_id: (rec as any).trip_id,
      status: (rec as any).status,
      member: {
        name: rider.full_name ?? null,
        medicaid_id: rider.medicaid_id ?? null,
        dob: rider.dob ?? null,
        address: rider.address ?? null,
        phone: rider.phone ?? null,
      },
      trip: {
        service_date: trip.pickup_at ?? null,
        trip_kind: trip.trip_kind ?? calc.trip_kind,
        vehicle_type: vehicleType,
        pickup_address: trip.pickup_address ?? null,
        dropoff_address: trip.dropoff_address ?? null,
        miles,
        long_distance: miles > LONG_DISTANCE_MILES,
        has_signed_form: Boolean(trip.state_pdf_path || trip.signature_path),
      },
      lines: calc.lines.map((l) => ({
        label: l.label,
        procedure_code: l.procedure_code,
        modifiers: [],
        units: l.units,
        unit_word: l.unit_word,
        rate: l.rate,
        amount: l.amount,
      })),
      total_charge: calc.total,
      diagnosis_code: calc.diagnosis_code,
      missing_rates: calc.missing_rates,
      provider: {
        billing_name: (setup as any)?.billing_name ?? null,
        npi: (setup as any)?.npi ?? null,
        taxonomy_code: (setup as any)?.taxonomy_code ?? null,
        configured: Boolean((setup as any)?.billing_name && (setup as any)?.npi),
      },
      edi: {
        edi_claim_id: (rec as any).edi_claim_id ?? null,
        edi_batch_id: (rec as any).edi_batch_id ?? null,
        edi_file_id: (rec as any).edi_file_id ?? null,
        edi_status: (rec as any).edi_status ?? null,
        edi_validation: ((rec as any).edi_validation ?? null) as Record<string, unknown> | null,
        edi_last_sync_at: (rec as any).edi_last_sync_at ?? null,
        edi_last_error: (rec as any).edi_last_error ?? null,
      },
    };
  });

/**
 * Persist EDI identifiers/state returned by the EDI backend.
 * Only the `edi_*` columns are ever written — the HCPF/robot columns and the
 * bill's own workflow status are never touched from here.
 */
export const saveEdiClaimState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        record_id: z.string().uuid(),
        edi_claim_id: z.number().int().positive().nullable().optional(),
        edi_batch_id: z.number().int().positive().nullable().optional(),
        edi_file_id: z.number().int().positive().nullable().optional(),
        edi_status: z.string().max(120).nullable().optional(),
        edi_validation: z.record(z.string(), z.unknown()).nullable().optional(),
        edi_last_error: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await guard(supabase, userId);

    const patch: Record<string, unknown> = { edi_last_sync_at: new Date().toISOString() };
    for (const key of [
      "edi_claim_id",
      "edi_batch_id",
      "edi_file_id",
      "edi_status",
      "edi_validation",
      "edi_last_error",
    ] as const) {
      if (data[key] !== undefined) patch[key] = data[key] ?? null;
    }

    const { error } = await supabase
      .from("billing_records")
      .update(patch as never)
      .eq("id", data.record_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
