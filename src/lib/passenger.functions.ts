import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normPhone(s: string) {
  return (s || "").replace(/\D/g, "");
}

/** PUBLIC — passenger app looks up their rides by phone or Medicaid ID (no auth). */
export const lookupPassengerRides = createServerFn({ method: "POST" })
  .inputValidator((input: { phone?: string; medicaidId?: string }) => {
    const phone = input.phone ? normPhone(input.phone) : "";
    const medicaidId = (input.medicaidId ?? "").trim();
    if (!phone && !medicaidId) throw new Error("Enter phone or Medicaid ID");
    if (phone && phone.length < 7) throw new Error("Phone too short");
    return { phone, medicaidId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin.from("passengers").select("id, first_name, last_name, phone, medicaid_id").limit(5);
    if (data.medicaidId) query = query.eq("medicaid_id", data.medicaidId);
    else query = query.ilike("phone", `%${data.phone.slice(-7)}%`);

    const { data: pax, error } = await query;
    if (error) throw new Error(error.message);
    if (!pax || pax.length === 0) return { passengers: [], trips: [] };

    const ids = pax.map((p) => p.id);
    const { data: trips } = await supabaseAdmin
      .from("trips")
      .select(
        "id, status, pickup_address, dropoff_address, scheduled_pickup_time, actual_pickup_time, actual_dropoff_time, driver_id, estimated_fare, passenger_id",
      )
      .in("passenger_id", ids)
      .order("scheduled_pickup_time", { ascending: false })
      .limit(20);

    const driverIds = Array.from(
      new Set((trips ?? []).map((t) => t.driver_id).filter(Boolean) as string[]),
    );
    const driverMap: Record<string, { name: string; phone: string | null; vehicle: string | null }> = {};
    if (driverIds.length) {
      const { data: drivers } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id, vehicle_make, vehicle_model, vehicle_plate")
        .in("id", driverIds);
      const userIds = (drivers ?? []).map((d) => d.user_id).filter(Boolean) as string[];
      const { data: profs } = userIds.length
        ? await supabaseAdmin.from("profiles").select("id, first_name, last_name, phone").in("id", userIds)
        : { data: [] as { id: string; first_name: string | null; last_name: string | null; phone: string | null }[] };
      const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
      (drivers ?? []).forEach((d) => {
        const p = d.user_id ? profMap.get(d.user_id) : undefined;
        driverMap[d.id] = {
          name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Your driver",
          phone: p?.phone ?? null,
          vehicle:
            [d.vehicle_make, d.vehicle_model].filter(Boolean).join(" ") +
            (d.vehicle_plate ? ` · ${d.vehicle_plate}` : ""),
        };
      });
    }

    return {
      passengers: pax.map((p) => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`.trim(),
        phone: p.phone,
      })),
      trips: (trips ?? []).map((t) => ({
        ...t,
        driver: t.driver_id ? driverMap[t.driver_id] ?? null : null,
      })),
    };
  });

/** DRIVER-ONLY — search passengers by phone or Medicaid ID during pickup. */
export const driverSearchPassengers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => ({ q: (input.q ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const q = data.q;
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    const { data: pax } = await context.supabase
      .from("passengers")
      .select("id, first_name, last_name, phone, medicaid_id")
      .or(
        [
          `medicaid_id.ilike.%${q}%`,
          digits.length >= 4 ? `phone.ilike.%${digits}%` : null,
          `first_name.ilike.%${q}%`,
          `last_name.ilike.%${q}%`,
        ]
          .filter(Boolean)
          .join(","),
      )
      .limit(10);
    return pax ?? [];
  });

/** DRIVER-ONLY — create a passenger on the fly at pickup. */
export const driverCreatePassenger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { first_name: string; last_name: string; phone?: string; medicaid_id?: string }) => {
      if (!input.first_name?.trim() || !input.last_name?.trim()) throw new Error("Name required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: isDriver } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "driver",
    });
    if (!isDriver) throw new Error("Driver only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const medicaid = data.medicaid_id?.trim() || `WALK-${Date.now().toString(36).toUpperCase()}`;
    const { data: inserted, error } = await supabaseAdmin
      .from("passengers")
      .insert({
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        phone: data.phone?.trim() || null,
        medicaid_id: medicaid,
      })
      .select("id, first_name, last_name, phone, medicaid_id")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

/**
 * PASSENGER-ONLY — set/refresh the passenger's own identity used on the
 * state PDF's "Member Health First Colorado ID #" field. The passenger
 * must provide EITHER a Medicaid ID OR (a full 9-digit SSN + DOB).
 * SSN is stored encrypted in Supabase Vault via `set_passenger_ssn`.
 */
export const updatePassengerIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { medicaid_id?: string; ssn?: string; date_of_birth?: string }) => {
    const medicaid_id = (input.medicaid_id ?? "").trim();
    const ssn = (input.ssn ?? "").replace(/\D/g, "");
    const date_of_birth = (input.date_of_birth ?? "").trim();
    if (medicaid_id) return { medicaid_id, ssn: "", date_of_birth: "" };
    if (ssn.length !== 9) {
      throw new Error("Enter a Medicaid ID, or a full 9-digit SSN plus date of birth.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
      throw new Error("Date of birth must be in YYYY-MM-DD format.");
    }
    return { medicaid_id: "", ssn, date_of_birth };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find or create this user's passenger row.
    const { data: existing } = await supabase
      .from("passengers")
      .select("id, first_name, last_name, email, phone")
      .eq("user_id", userId)
      .maybeSingle();

    let passengerId = existing?.id ?? null;
    if (!passengerId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, email, phone")
        .eq("id", userId)
        .maybeSingle();
      const { data: created, error: insErr } = await supabaseAdmin
        .from("passengers")
        .insert({
          user_id: userId,
          first_name: profile?.first_name ?? "",
          last_name: profile?.last_name ?? "",
          email: profile?.email ?? null,
          phone: profile?.phone ?? "",
          medicaid_id: data.medicaid_id || `SELF-${userId.slice(0, 8)}`,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      passengerId = created.id;
    }

    if (data.medicaid_id) {
      const { error: updErr } = await supabaseAdmin
        .from("passengers")
        .update({ medicaid_id: data.medicaid_id })
        .eq("id", passengerId);
      if (updErr) throw new Error(updErr.message);
      return { ok: true, passenger_id: passengerId, path: "medicaid" as const };
    }

    // SSN + DOB path: store DOB in plain column, encrypt SSN into Vault.
    const { error: dobErr } = await supabaseAdmin
      .from("passengers")
      .update({ date_of_birth: data.date_of_birth })
      .eq("id", passengerId);
    if (dobErr) throw new Error(dobErr.message);

    const { error: ssnErr } = await supabase.rpc("set_passenger_ssn", {
      _passenger_id: passengerId,
      _ssn: data.ssn,
    });
    if (ssnErr) throw new Error(ssnErr.message);

    return { ok: true, passenger_id: passengerId, path: "ssn_dob" as const };
  });

/** PASSENGER-ONLY — quick check of what identity the passenger has on file. */
export const getPassengerIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("passengers")
      .select("id, medicaid_id, date_of_birth, ssn_last4, ssn_secret_id")
      .eq("user_id", userId)
      .maybeSingle();
    const medicaidId = (data?.medicaid_id ?? "").trim();
    const hasRealMedicaid =
      !!medicaidId && !medicaidId.startsWith("SELF-") && !medicaidId.startsWith("WALK-");
    const hasSsnDob = !!data?.ssn_secret_id && !!data?.date_of_birth;
    return {
      passenger_id: data?.id ?? null,
      medicaid_id: hasRealMedicaid ? medicaidId : "",
      date_of_birth: data?.date_of_birth ?? "",
      ssn_last4: data?.ssn_last4 ?? "",
      has_identity: hasRealMedicaid || hasSsnDob,
    };
  });

