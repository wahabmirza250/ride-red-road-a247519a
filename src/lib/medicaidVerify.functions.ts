import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VerifyStatus =
  | "matched"
  | "fuzzy"
  | "no_match"
  | "found"
  | "not_found"
  | "unconfigured"
  | "error";

export type VerifyResult = {
  status: VerifyStatus;
  message: string;
  portal_name?: string | null;
  matched_name?: string | null;
  medicaid_id?: string | null;
  match_confidence?: number | null;
  used_identifier: "medicaid_id" | "ssn_dob" | "none";
};

export type KnownPassenger = {
  id: string;
  name: string;
  medicaid_id: string | null;
  phone: string | null;
};

/**
 * READ-ONLY identity verification against the HCPF portal via the automation
 * robot's `verify_member` action. Never submits or touches a claim.
 *
 * Callable by admins and by drivers who currently have a trip with the
 * passenger.
 */
export const verifyPassengerIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { passenger_id: string }) => {
    if (!input.passenger_id) throw new Error("passenger_id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<VerifyResult> => {
    const { supabase, userId } = context;

    // AuthZ: admin OR a driver who currently has a trip with this passenger.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    let allowed = !!isAdmin;
    if (!allowed) {
      const { data: isDriver } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "driver",
      });
      if (isDriver) {
        const { data: allow } = await supabase.rpc("driver_can_see_passenger", {
          _passenger_id: data.passenger_id,
        });
        allowed = !!allow;
      }
    }
    if (!allowed) throw new Error("Not authorized to verify this passenger");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callVerifyRobot, getRobotApiKey, resolveProviderUserId } = await import(
      "@/lib/medicaidVerify.server"
    );

    const { data: pax, error } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, date_of_birth, ssn_secret_id")
      .eq("id", data.passenger_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!pax) throw new Error("Passenger not found");

    const medicaidRaw = (pax.medicaid_id ?? "").trim();
    const hasRealMedicaid =
      !!medicaidRaw && !medicaidRaw.startsWith("SELF-") && !medicaidRaw.startsWith("WALK-");

    let ssn: string | null = null;
    if (!hasRealMedicaid && pax.ssn_secret_id) {
      const { data: ssnData } = await supabaseAdmin.rpc(
        "get_decrypted_passenger_ssn",
        { _passenger_id: pax.id },
      );
      ssn = (ssnData as string | null) ?? null;
    }

    const usedIdentifier: VerifyResult["used_identifier"] = hasRealMedicaid
      ? "medicaid_id"
      : ssn && pax.date_of_birth
        ? "ssn_dob"
        : "none";

    if (usedIdentifier === "none") {
      return {
        status: "error",
        message:
          "No Medicaid ID or SSN+DOB on file. Ask the passenger to complete identity verification first.",
        used_identifier: "none",
      };
    }

    return callVerifyRobot({
      providerUserId: await resolveProviderUserId(supabaseAdmin as any, userId),
      expectedName: `${pax.first_name ?? ""} ${pax.last_name ?? ""}`.trim(),
      memberId: hasRealMedicaid ? medicaidRaw : null,
      ssn,
      dateOfBirth: pax.date_of_birth ?? null,
      usedIdentifier,
      apiKey: await getRobotApiKey(supabaseAdmin as any),
    });
  });

/**
 * Same READ-ONLY portal check, but for a Medicaid ID typed in by hand — used
 * by the standalone lookup tool on the driver home screen. ID-only: it reports
 * whichever name the portal has on file, with no name comparison.
 */
export const verifyMedicaidIdAdHoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { medicaid_id: string }) => {
    const medicaid_id = (input.medicaid_id ?? "").trim();
    if (!medicaid_id) throw new Error("Medicaid ID is required");
    return { medicaid_id };
  })
  .handler(async ({ data, context }): Promise<VerifyResult> => {
    const { supabase, userId } = context;

    // AuthZ: staff only (driver, dispatch or admin).
    const [{ data: isAdmin }, { data: isDispatch }, { data: isDriver }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("current_user_is_dispatch"),
      supabase.rpc("has_role", { _user_id: userId, _role: "driver" }),
    ]);
    const allowed = !!isAdmin || !!isDispatch || !!isDriver;
    if (!allowed) throw new Error("Not authorized to run verification");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callVerifyRobot, getRobotApiKey, resolveProviderUserId } = await import(
      "@/lib/medicaidVerify.server"
    );

    return callVerifyRobot({
      providerUserId: await resolveProviderUserId(supabaseAdmin as any, userId),
      expectedName: "",
      memberId: data.medicaid_id,
      ssn: null,
      dateOfBirth: null,
      usedIdentifier: "medicaid_id",
      lookupOnly: true,
      apiKey: await getRobotApiKey(supabaseAdmin as any),
    });
  });


/**
 * Passengers this driver has driven (or is scheduled to drive), so the
 * standalone verification tool can offer a picker instead of manual typing.
 * Admins and dispatchers get the full active passenger list.
 */
export const listVerifiablePassengers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { search?: string }) => ({
    search: (input?.search ?? "").trim(),
  }))
  .handler(async ({ data, context }): Promise<KnownPassenger[]> => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isDispatch } = await supabase.rpc("current_user_is_dispatch");
    const { data: isDriver } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "driver",
    });
    if (!isAdmin && !isDispatch && !isDriver) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let ids: string[] | null = null;
    if (!isAdmin && !isDispatch) {
      // Driver: only passengers on their own trips.
      const { data: driverRow } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!driverRow) return [];
      const { data: trips } = await supabaseAdmin
        .from("trips")
        .select("passenger_id")
        .eq("driver_id", driverRow.id)
        .order("scheduled_pickup_time", { ascending: false })
        .limit(300);
      ids = Array.from(
        new Set((trips ?? []).map((t) => t.passenger_id).filter(Boolean) as string[]),
      );
      if (ids.length === 0) return [];
    }

    let q = supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, phone, updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(25);
    if (ids) q = q.in("id", ids);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ");
      q = q.or(
        `first_name.ilike.%${s}%,last_name.ilike.%${s}%,medicaid_id.ilike.%${s}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows ?? []).map((p) => ({
      id: p.id,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unnamed passenger",
      medicaid_id: p.medicaid_id ?? null,
      phone: p.phone ?? null,
    }));
  });
