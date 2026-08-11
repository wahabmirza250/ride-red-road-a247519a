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
  company_id: string;
  provider_id: string;
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

  const { data: existing, error: findErr } = await supabase
    .from("billing_rate_settings")
    .select("id")
    .eq("company_id", company_id)
    .eq("vehicle_type", vehicle_type)
    .eq("unit_type", unit_type)
    .maybeSingle();
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
    company_id: string;
    provider_id: string;
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
