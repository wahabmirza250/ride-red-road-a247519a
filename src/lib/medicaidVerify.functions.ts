import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VerifyResult = {
  status: "matched" | "no_match" | "unconfigured" | "error";
  message: string;
  matched_name?: string | null;
  medicaid_id?: string | null;
  used_identifier: "medicaid_id" | "ssn_dob" | "none";
};

/**
 * Verify the passenger's Medicaid ID (or SSN+DOB fallback) against the state
 * portal via the automation robot. READ-ONLY — never submits a claim.
 *
 * Callable by admins and drivers. Drivers must have an active/assigned trip
 * with this passenger; admins can verify anyone.
 */
export const verifyPassengerIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { passenger_id: string }) => {
    if (!input.passenger_id) throw new Error("passenger_id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<VerifyResult> => {
    const { supabase, userId } = context;

    // Authorization: admin OR a driver who currently has a trip with this passenger.
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

    const url = process.env.MEDICAID_VERIFY_URL;
    if (!url) {
      return {
        status: "unconfigured",
        message:
          "Verification endpoint is not configured yet. Set MEDICAID_VERIFY_URL to enable live lookups.",
        used_identifier: usedIdentifier,
        medicaid_id: hasRealMedicaid ? medicaidRaw : null,
      };
    }

    // Robot API key — same shared secret used by the billing automation.
    const { data: keyRow } = await supabaseAdmin
      .from("robot_api_keys" as any)
      .select("api_key")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const apiKey = (keyRow as { api_key?: string } | null)?.api_key ?? "";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          first_name: pax.first_name ?? "",
          last_name: pax.last_name ?? "",
          medicaid_id: hasRealMedicaid ? medicaidRaw : null,
          ssn: hasRealMedicaid ? null : ssn,
          date_of_birth: hasRealMedicaid ? null : pax.date_of_birth,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          status: "error",
          message: `Verification endpoint returned ${res.status}. ${text.slice(0, 200)}`,
          used_identifier: usedIdentifier,
        };
      }

      const body = (await res.json().catch(() => ({}))) as {
        matched?: boolean;
        matched_name?: string;
        medicaid_id?: string;
        message?: string;
      };

      if (body.matched) {
        return {
          status: "matched",
          message: `Verified — matches ${body.matched_name ?? `${pax.first_name} ${pax.last_name}`.trim()}`,
          matched_name: body.matched_name ?? `${pax.first_name} ${pax.last_name}`.trim(),
          medicaid_id: body.medicaid_id ?? (hasRealMedicaid ? medicaidRaw : null),
          used_identifier: usedIdentifier,
        };
      }
      return {
        status: "no_match",
        message:
          body.message ??
          "No match found — please confirm the passenger's name, Medicaid ID, or SSN+DOB.",
        used_identifier: usedIdentifier,
      };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Verification request failed",
        used_identifier: usedIdentifier,
      };
    }
  });
