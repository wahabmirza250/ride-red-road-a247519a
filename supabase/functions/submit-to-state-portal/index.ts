// Submit approved medicaid trip billing records to the external state portal
// automation service. Called by the admin dashboard.
//
// Auth: JWT-verified (default). Caller must have the admin role.
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   AUTOMATION_SERVICE_URL           - e.g. https://runner.example.com
//   AUTOMATION_SERVICE_API_KEY       - shared x-api-key
//   AUTOMATION_SERVICE_HMAC_SECRET   - shared HMAC secret (also used to verify callback)
//   SITE_URL                         - public base URL for the webhook callback

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return json({ error: "method not allowed" }, { status: 405 });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const AUTOMATION_URL = Deno.env.get("AUTOMATION_SERVICE_URL");
  const AUTOMATION_KEY = Deno.env.get("AUTOMATION_SERVICE_API_KEY");
  const HMAC_SECRET = Deno.env.get("AUTOMATION_SERVICE_HMAC_SECRET");
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, { status: 401 });

  // Client bound to the caller (RLS as user) so we can verify identity
  const asUser = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden" }, { status: 403 });

  let payload: { billing_record_ids?: string[] };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  const ids = payload.billing_record_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return json({ error: "billing_record_ids required" }, { status: 400 });

  const notConfigured = !AUTOMATION_URL || !AUTOMATION_KEY || !HMAC_SECRET;

  const results: Array<{
    id: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const id of ids) {
    // Load billing record + trip + rider
    const { data: rec, error: recErr } = await admin
      .from("billing_records")
      .select(
        "id, status, trip_id, medicaid_trips(*, riders(*))",
      )
      .eq("id", id)
      .single();

    if (recErr || !rec) {
      results.push({ id, ok: false, error: recErr?.message ?? "not found" });
      continue;
    }
    if (rec.status !== "pending_submit" && rec.status !== "submitting") {
      results.push({
        id,
        ok: false,
        error: `wrong status: ${rec.status}`,
      });
      continue;
    }

    // Flip to submitting
    await admin
      .from("billing_records")
      .update({ status: "submitting", submission_error: null })
      .eq("id", id);
    await admin.from("billing_audit_log").insert({
      billing_record_id: id,
      action: "submitting",
      actor_id: userId,
      actor_type: "admin",
    });

    if (notConfigured) {
      const msg =
        "Automation service not configured (AUTOMATION_SERVICE_URL / API_KEY / HMAC_SECRET missing).";
      await admin
        .from("billing_records")
        .update({ status: "pending_submit", submission_error: msg })
        .eq("id", id);
      await admin.from("billing_audit_log").insert({
        billing_record_id: id,
        action: "submit_failed",
        actor_id: userId,
        actor_type: "system",
        notes: msg,
      });
      results.push({ id, ok: false, error: msg });
      continue;
    }

    // Signed URLs for PDF + signature
    const trip: any = rec.medicaid_trips;
    let pdf_url: string | null = null;
    let signature_url: string | null = null;
    if (trip?.state_pdf_path) {
      const { data: s } = await admin.storage
        .from("state-pdfs")
        .createSignedUrl(trip.state_pdf_path, 60 * 30);
      pdf_url = s?.signedUrl ?? null;
    }
    if (trip?.signature_path) {
      const { data: s } = await admin.storage
        .from("signatures")
        .createSignedUrl(trip.signature_path, 60 * 30);
      signature_url = s?.signedUrl ?? null;
    }

    const body = JSON.stringify({
      billing_record_id: id,
      callback_url: `${SITE_URL.replace(/\/$/, "")}/api/public/receive-submission-result`,
      trip: {
        id: trip?.id,
        pickup_at: trip?.pickup_at,
        pickup_address: trip?.pickup_address,
        dropoff_address: trip?.dropoff_address,
        odometer_start: trip?.odometer_start,
        odometer_end: trip?.odometer_end,
        miles: trip?.miles,
      },
      rider: trip?.riders,
      pdf_url,
      signature_url,
      issued_at: new Date().toISOString(),
    });

    const sig = await hmacHex(HMAC_SECRET!, body);

    try {
      const res = await fetch(
        `${AUTOMATION_URL!.replace(/\/$/, "")}/submit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": AUTOMATION_KEY!,
            "x-signature": sig,
          },
          body,
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Runner rejected: ${res.status} ${txt}`);
      }
      results.push({ id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("billing_records")
        .update({ status: "pending_submit", submission_error: msg })
        .eq("id", id);
      await admin.from("billing_audit_log").insert({
        billing_record_id: id,
        action: "submit_failed",
        actor_id: userId,
        actor_type: "system",
        notes: msg,
      });
      results.push({ id, ok: false, error: msg });
    }
  }

  return json({ ok: true, results });
});
