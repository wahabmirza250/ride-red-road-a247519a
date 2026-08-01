import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VerifyStatus =
  | "matched"
  | "fuzzy"
  | "no_match"
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
    let providerUserId = userId;
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

    const expectedName = `${pax.first_name ?? ""} ${pax.last_name ?? ""}`.trim();

    if (usedIdentifier === "none") {
      return {
        status: "error",
        message:
          "No Medicaid ID or SSN+DOB on file. Ask the passenger to complete identity verification first.",
        used_identifier: "none",
      };
    }

    // If we pick up a provider record (single-provider default), use its owner
    // as provider_id so the robot loads the right portal credentials.
    const { data: providerRow } = await supabaseAdmin
      .from("billing_rate_settings")
      .select("provider_id")
      .limit(1)
      .maybeSingle();
    if (providerRow?.provider_id) providerUserId = providerRow.provider_id;

    const url = process.env.ROBOT_VERIFY_URL;
    if (!url) {
      return {
        status: "unconfigured",
        message:
          "Verification endpoint is not configured yet. Ask an admin to set the ROBOT_VERIFY_URL secret.",
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
          "X-Robot-Api-Key": apiKey,
        },
        body: JSON.stringify({
          provider_id: providerUserId,
          expected_name: expectedName,
          member_id: hasRealMedicaid ? medicaidRaw : null,
          ssn: hasRealMedicaid ? null : ssn,
          date_of_birth: hasRealMedicaid ? null : pax.date_of_birth,
        }),
      });

      if (!res.ok) {
        return {
          status: "error",
          message: "Verification unavailable, try again.",
          used_identifier: usedIdentifier,
        };
      }

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        portal_name?: string | null;
        matched?: boolean;
        // The robot returns a label ("exact" / "fuzzy" / "partial"), not a number.
        match_confidence?: number | string | null;
      };

      if (!body.ok) {
        return {
          status: "error",
          message: "Verification unavailable, try again.",
          used_identifier: usedIdentifier,
        };
      }

      const portalName = body.portal_name ?? null;
      const rawConfidence = body.match_confidence;
      const confidence =
        typeof rawConfidence === "number"
          ? rawConfidence
          : typeof rawConfidence === "string"
            ? /^exact$/i.test(rawConfidence.trim())
              ? 1
              : /^(fuzzy|partial|close)$/i.test(rawConfidence.trim())
                ? 0.5
                : Number.isFinite(Number(rawConfidence))
                  ? Number(rawConfidence)
                  : null
            : null;


      // Exact = matched true AND confidence >= 0.95 (or null with matched=true)
      // Fuzzy = matched true but confidence < 0.95
      // No match = matched false
      if (body.matched && (confidence === null || confidence >= 0.95)) {
        return {
          status: "matched",
          message: `Verified — matches ${portalName ?? expectedName}`,
          portal_name: portalName,
          matched_name: portalName ?? expectedName,
          medicaid_id: hasRealMedicaid ? medicaidRaw : null,
          match_confidence: confidence,
          used_identifier: usedIdentifier,
        };
      }
      if (body.matched) {
        return {
          status: "fuzzy",
          message: `Possible match — please double-check spelling (${portalName ?? "unknown"})`,
          portal_name: portalName,
          matched_name: portalName,
          medicaid_id: hasRealMedicaid ? medicaidRaw : null,
          match_confidence: confidence,
          used_identifier: usedIdentifier,
        };
      }
      return {
        status: "no_match",
        message: "No match found — please confirm passenger details.",
        portal_name: portalName,
        match_confidence: confidence,
        used_identifier: usedIdentifier,
      };
    } catch {
      return {
        status: "error",
        message: "Verification unavailable, try again.",
        used_identifier: usedIdentifier,
      };
    }
  });
