import type { VerifyResult } from "@/lib/medicaidVerify.functions";

/**
 * Shared READ-ONLY portal call used by every verification entry point
 * (assigned-trip passenger, saved passenger picker, manual entry).
 * Never submits or touches a claim.
 */
export async function callVerifyRobot(args: {
  providerUserId: string;
  expectedName: string;
  memberId: string | null;
  ssn: string | null;
  dateOfBirth: string | null;
  usedIdentifier: VerifyResult["used_identifier"];
  apiKey: string;
  /** ID-only lookup: report the portal name instead of comparing to a name. */
  lookupOnly?: boolean;
}): Promise<VerifyResult> {
  const { expectedName, memberId, usedIdentifier, lookupOnly } = args;

  const url = process.env.ROBOT_VERIFY_URL;
  if (!url) {
    return {
      status: "unconfigured",
      message:
        "Verification endpoint is not configured yet. Ask an admin to set the ROBOT_VERIFY_URL secret.",
      used_identifier: usedIdentifier,
      medicaid_id: memberId,
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Robot-Api-Key": args.apiKey,
      },
      body: JSON.stringify({
        provider_id: args.providerUserId,
        expected_name: expectedName,
        member_id: memberId,
        ssn: memberId ? null : args.ssn,
        date_of_birth: memberId ? null : args.dateOfBirth,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[verify-member] HTTP", res.status, detail.slice(0, 300));
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
    const confidence = normalizeConfidence(body.match_confidence);

    if (lookupOnly) {
      if (portalName) {
        return {
          status: "found",
          message: `This ID belongs to: ${portalName}`,
          portal_name: portalName,
          matched_name: portalName,
          medicaid_id: memberId,
          used_identifier: usedIdentifier,
        };
      }
      return {
        status: "not_found",
        message: "No record found for this ID.",
        medicaid_id: memberId,
        used_identifier: usedIdentifier,
      };
    }


    // Exact = matched true AND confidence >= 0.95 (or null with matched=true)
    // Fuzzy = matched true but confidence < 0.95
    // No match = matched false
    if (body.matched && (confidence === null || confidence >= 0.95)) {
      return {
        status: "matched",
        message: `Verified — matches ${portalName ?? expectedName}`,
        portal_name: portalName,
        matched_name: portalName ?? expectedName,
        medicaid_id: memberId,
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
        medicaid_id: memberId,
        match_confidence: confidence,
        used_identifier: usedIdentifier,
      };
    }
    return {
      status: "no_match",
      message: "No match found — please confirm passenger details.",
      portal_name: portalName,
      medicaid_id: memberId,
      match_confidence: confidence,
      used_identifier: usedIdentifier,
    };
  } catch (e) {
    console.error("[verify-member] fetch failed", e);
    return {
      status: "error",
      message: "Verification unavailable, try again.",
      used_identifier: usedIdentifier,
    };
  }
}

function normalizeConfidence(raw: number | string | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^exact$/i.test(v)) return 1;
  if (/^(fuzzy|partial|close)$/i.test(v)) return 0.5;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Newest active shared robot key, or "" when none is configured. */
export async function getRobotApiKey(supabaseAdmin: {
  from: (t: string) => any;
}): Promise<string> {
  const { data } = await supabaseAdmin
    .from("robot_api_keys")
    .select("api_key")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { api_key?: string } | null)?.api_key ?? "";
}

/**
 * Provider whose portal credentials the robot should log in with.
 * Scoped to the caller's own company so a rate row belonging to another
 * tenant can never be picked up.
 */
export async function resolveProviderUserId(
  supabaseAdmin: { from: (t: string) => any },
  fallback: string,
): Promise<string> {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", fallback)
    .maybeSingle();
  const companyId = (prof as { company_id?: string } | null)?.company_id ?? null;

  let query = supabaseAdmin.from("billing_rate_settings").select("provider_id");
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query.limit(1).maybeSingle();
  return (data as { provider_id?: string } | null)?.provider_id ?? fallback;
}
