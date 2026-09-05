/**
 * Rate persistence helpers.
 *
 * A company must only ever have ONE rate row per (vehicle_type, unit_type) —
 * enforced in the database by a partial unique index. Because PostgREST cannot
 * infer a partial unique index for `ON CONFLICT`, we do an explicit
 * update-or-insert here instead of `.upsert()`. This is what guarantees editing
 * a rate updates the existing row rather than forking a new one.
 */

export type SaveRateInput = {
  company_id: string | null;
  provider_id: string | null;
  vehicle_type: string;
  unit_type: string;
  procedure_code: string;
  charge_amount: number;
  place_of_service: string | null;
  default_diagnosis_code?: string | null;
};

export async function saveRateRow(
  supabase: { from: (t: string) => any },
  input: SaveRateInput,
) {
  const { company_id, vehicle_type, unit_type, ...rest } = input;

  let existingQuery = supabase
    .from("billing_rate_settings")
    .select("id")
    .eq("vehicle_type", vehicle_type)
    .eq("unit_type", unit_type);
  existingQuery = company_id
    ? existingQuery.eq("company_id", company_id)
    : existingQuery.is("company_id", null);
  const { data: existing, error: findErr } = await existingQuery.maybeSingle();
  if (findErr) throw new Error(findErr.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from("billing_rate_settings")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("billing_rate_settings")
    .insert({ company_id, vehicle_type, unit_type, ...rest })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveRatePair(
  supabase: { from: (t: string) => any },
  args: {
    company_id: string | null;
    provider_id: string | null;
    vehicle_type: string;
    default_diagnosis_code: string;
    trip: { procedure_code: string; charge_amount: number; place_of_service: string };
    mile: { procedure_code: string; charge_amount: number; place_of_service: string };
  },
) {
  const out = [];
  for (const unit of ["trip", "mile"] as const) {
    const s = args[unit];
    out.push(
      await saveRateRow(supabase, {
        company_id: args.company_id,
        provider_id: args.provider_id,
        vehicle_type: args.vehicle_type,
        unit_type: unit,
        procedure_code: s.procedure_code.trim(),
        charge_amount: Number(s.charge_amount),
        place_of_service: s.place_of_service.trim(),
        default_diagnosis_code: args.default_diagnosis_code.trim(),
      }),
    );
  }
  return out;
}

/**
 * The rate rows that apply to a COMPANY.
 *
 * Rates are owned by the company (and stamped with the provider that owns
 * them). Older installs kept a single unscoped row set (`company_id IS NULL`);
 * those are still honoured as a legacy fallback so nothing that bills today
 * stops billing, but a company row always wins.
 */
export async function loadRateRows(
  supabase: { from: (t: string) => any },
  args: { companyId: string | null; vehicleType?: string },
): Promise<{ rows: any[]; scope: "company" | "legacy" }> {
  const select =
    "id, provider_id, company_id, vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code, updated_at";

  if (args.companyId) {
    let q = supabase.from("billing_rate_settings").select(select).eq("company_id", args.companyId);
    if (args.vehicleType) q = q.eq("vehicle_type", args.vehicleType);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read billing rates: ${error.message}`);
    if ((data ?? []).length) return { rows: data ?? [], scope: "company" };
  }

  let legacy = supabase.from("billing_rate_settings").select(select).is("company_id", null);
  if (args.vehicleType) legacy = legacy.eq("vehicle_type", args.vehicleType);
  const { data, error } = await legacy;
  if (error) throw new Error(`Could not read billing rates: ${error.message}`);
  return { rows: data ?? [], scope: "legacy" };
}
