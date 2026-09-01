/**
 * SERVER ONLY — loads RedArt bills into the Super EDI shape.
 *
 * One loader feeds the single-record review, the bulk Batch Review table and
 * every bulk operation, so the payload a claim is validated with is exactly
 * what the biller saw. Reads only; the EDI writers live in `ediBulk.functions`.
 */
import { ediIsValid, ediValidationIssues } from "@/lib/edi";
import { ediBackendStatus } from "@/lib/ediStatusFeed";
import { readEdiLongDistance } from "@/lib/ediLongDistance";
import { localClaimBlockers } from "@/lib/ediPayload";
import type { EdiTripDetail, EdiWorkRow } from "@/lib/ediTypes";

type Sb = { from: (table: string) => any };

const RECORD_SELECT = `id, trip_id, company_id, status, created_at,
  edi_claim_id, edi_batch_id, edi_file_id, edi_status, edi_validation,
  edi_status_detail, edi_environment,
  edi_last_sync_at, edi_last_error,
  medicaid_trips!inner(id, pickup_at, pickup_address, dropoff_address, miles,
    odometer_start, odometer_end, trip_kind, vehicle_type, state_pdf_path,
    signature_path, company_id,
    riders(full_name, medicaid_id, dob, address, phone),
    medicaid_trip_legs(leg_index, leg_date, pickup_odometer, dropoff_odometer,
      pickup_address, dropoff_address, pickup_time, dropoff_time))`;

export type LoadEdiRecordsOptions = {
  recordIds?: string[];
  /** Bills for these trips — used right after a paper import. */
  tripIds?: string[];
  search?: string;
  limit?: number;
  offset?: number;
  /** Only bills already linked to an EDI claim. */
  linkedOnly?: boolean;
  /** Only bills with no EDI claim yet. */
  unlinkedOnly?: boolean;
};

/** Company billing rates, keyed by vehicle type. */
async function loadRates(supabase: Sb, companyId: string) {
  const { data } = await supabase
    .from("billing_rate_settings")
    .select(
      "vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
    )
    .eq("company_id", companyId);
  const byVehicle = new Map<string, any[]>();
  for (const row of (data ?? []) as any[]) {
    const key = String(row.vehicle_type ?? "ambulatory");
    byVehicle.set(key, [...(byVehicle.get(key) ?? []), row]);
  }
  return byVehicle;
}

async function loadProvider(supabase: Sb, companyId: string) {
  const { data } = await supabase
    .from("edi_company_settings")
    .select(
      "billing_name, npi, taxonomy_code, tax_id, address_line1, address_line2, city, state, postal_code, phone, sender_id, receiver_id",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  const s = (data ?? {}) as Record<string, any>;
  return {
    billing_name: s["billing_name"] ?? null,
    npi: s["npi"] ?? null,
    taxonomy_code: s["taxonomy_code"] ?? null,
    tax_id: s["tax_id"] ?? null,
    address_line1: s["address_line1"] ?? null,
    address_line2: s["address_line2"] ?? null,
    city: s["city"] ?? null,
    state: s["state"] ?? null,
    postal_code: s["postal_code"] ?? null,
    phone: s["phone"] ?? null,
    sender_id: s["sender_id"] ?? null,
    receiver_id: s["receiver_id"] ?? null,
    configured: Boolean(s["billing_name"] && s["npi"]),
  };
}

/**
 * Loads full EDI detail for the requested bills of ONE company.
 * `resubmission_id` rows are excluded: corrected HCPF resubmissions stay in the
 * legacy robot workflow and must never be pulled into an 837P by accident.
 */
export async function loadEdiDetails(
  supabase: Sb,
  companyId: string,
  opts: LoadEdiRecordsOptions = {},
): Promise<EdiTripDetail[]> {
  const ids = opts.recordIds?.filter(Boolean) ?? null;
  if (ids && ids.length === 0) return [];
  const tripIds = opts.tripIds?.filter(Boolean) ?? null;
  if (tripIds && tripIds.length === 0) return [];

  let q = supabase
    .from("billing_records")
    .select(RECORD_SELECT)
    .eq("company_id", companyId)
    .is("resubmission_id", null)
    .order("created_at", { ascending: false });

  if (ids) q = q.in("id", ids).limit(ids.length);
  else if (tripIds) q = q.in("trip_id", tripIds).limit(tripIds.length);
  else {
    if (opts.linkedOnly) q = q.not("edi_claim_id", "is", null);
    if (opts.unlinkedOnly) q = q.is("edi_claim_id", null);
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    q = q.range(offset, offset + limit - 1);
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const [rates, provider] = await Promise.all([
    loadRates(supabase, companyId),
    loadProvider(supabase, companyId),
  ]);

  const { calcClaim } = await import("@/lib/claimCalc");
  const { normalizeTripLegs } = await import("@/lib/billingHelpers");

  const details = ((rows ?? []) as any[]).map((rec): EdiTripDetail => {
    const trip: any = rec.medicaid_trips ?? {};
    const rider: any = trip.riders ?? {};
    const vehicleType = String(trip.vehicle_type ?? "ambulatory");
    const legs = normalizeTripLegs(trip).map((l) => ({
      pickup_odometer: l.pickup_odometer,
      dropoff_odometer: l.dropoff_odometer,
    }));
    const calc = calcClaim({ legs, rates: (rates.get(vehicleType) ?? []) as any, vehicleType });

    return {
      record_id: rec.id,
      trip_id: rec.trip_id,
      company_id: rec.company_id,
      status: rec.status,
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
        miles: calc.miles || Number(trip.miles ?? 0),
        leg_count: legs.length,
        has_signed_form: Boolean(trip.state_pdf_path || trip.signature_path),
      },
      lines: calc.lines.map((l) => ({
        label: l.label,
        procedure_code: l.procedure_code,
        modifiers: [] as string[],
        units: l.units,
        unit_word: l.unit_word,
        rate: l.rate,
        amount: l.amount,
      })),
      total_charge: calc.total,
      diagnosis_code: calc.diagnosis_code,
      missing_rates: calc.missing_rates,
      provider,
      edi: {
        edi_claim_id: rec.edi_claim_id ?? null,
        edi_batch_id: rec.edi_batch_id ?? null,
        edi_file_id: rec.edi_file_id ?? null,
        edi_status: rec.edi_status ?? null,
        edi_validation_json: rec.edi_validation ? JSON.stringify(rec.edi_validation) : null,
        edi_status_detail_json: rec.edi_status_detail ? JSON.stringify(rec.edi_status_detail) : null,
        edi_environment: rec.edi_environment ?? null,
        edi_last_sync_at: rec.edi_last_sync_at ?? null,
        edi_last_error: rec.edi_last_error ?? null,
      },
    };
  });

  const term = (opts.search ?? "").trim().toLowerCase();
  if (!term) return details;
  return details.filter((d) =>
    [
      d.member.name,
      d.member.medicaid_id,
      d.trip.pickup_address,
      d.trip.dropoff_address,
      d.trip.service_date?.slice(0, 10),
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term)),
  );
}

/** Flattens one detail into the bulk table row the workspace renders. */
export function toWorkRow(d: EdiTripDetail): EdiWorkRow {
  const validation = parseJson(d.edi.edi_validation_json);
  const statusDetail = parseJson(d.edi.edi_status_detail_json);
  return {
    record_id: d.record_id,
    trip_id: d.trip_id,
    status: d.status,
    member_name: d.member.name,
    medicaid_id: d.member.medicaid_id,
    service_date: d.trip.service_date,
    pickup_address: d.trip.pickup_address,
    dropoff_address: d.trip.dropoff_address,
    miles: d.trip.miles,
    units: d.lines.reduce((sum, l) => sum + l.units, 0),
    procedure_codes: [...new Set(d.lines.map((l) => l.procedure_code).filter(Boolean))] as string[],
    modifiers: [...new Set(d.lines.flatMap((l) => l.modifiers))],
    diagnosis_code: d.diagnosis_code,
    total_charge: d.total_charge,
    provider_name: d.provider.billing_name,
    edi_claim_id: d.edi.edi_claim_id,
    edi_batch_id: d.edi.edi_batch_id,
    edi_file_id: d.edi.edi_file_id,
    edi_status: d.edi.edi_status,
    edi_ready: validation ? ediIsValid(validation) : null,
    edi_issues: validation ? ediValidationIssues(validation).map((i) => i.message) : [],
    edi_last_error: d.edi.edi_last_error,
    edi_last_sync_at: d.edi.edi_last_sync_at,
    edi_environment: d.edi.edi_environment,
    backend_status: ediBackendStatus(statusDetail),
    status_detail_json: d.edi.edi_status_detail_json,
    local_blockers: localClaimBlockers(d),
    // Both payloads are consulted: the backend may report document rules on
    // the validation result or later on the claim status.
    long_distance: readEdiLongDistance(validation, statusDetail),
  };
}

function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
