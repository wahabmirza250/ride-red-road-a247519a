import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Utility: verify admin, throw on failure */
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

const StatusEnum = z.enum([
  "pending_review",
  "pending_submit",
  "submitting",
  "submitted",
  "approved",
  "rejected",
  "needs_fix",
]);

/* ---------- LIST ---------- */

export const listBillingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: StatusEnum }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rows, error } = await supabase
      .from("billing_records")
      .select(
        `id, trip_id, status, reviewed_at, fix_notes, rejection_reason,
         submitted_at, state_confirmation_number, submission_error, updated_at,
         medicaid_trips!inner(
           id, pickup_at, pickup_address, dropoff_address, driver_id,
           riders(full_name, medicaid_id)
         )`,
      )
      .eq("status", data.status)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Second query for driver profiles (avoids ambiguous FK join)
    const driverIds = Array.from(
      new Set(
        (rows ?? [])
          .map((r: any) => r.medicaid_trips?.driver_id)
          .filter(Boolean),
      ),
    );
    let profiles: Record<string, { first_name: string; last_name: string }> = {};
    if (driverIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", driverIds);
      profiles = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, p]),
      );
    }

    return (rows ?? []).map((r: any) => ({
      id: r.id,
      trip_id: r.trip_id,
      status: r.status,
      reviewed_at: r.reviewed_at,
      fix_notes: r.fix_notes,
      rejection_reason: r.rejection_reason,
      submitted_at: r.submitted_at,
      state_confirmation_number: r.state_confirmation_number,
      submission_error: r.submission_error,
      updated_at: r.updated_at,
      passenger_name: r.medicaid_trips?.riders?.full_name ?? null,
      medicaid_id: r.medicaid_trips?.riders?.medicaid_id ?? null,
      driver_name: profiles[r.medicaid_trips?.driver_id]
        ? `${profiles[r.medicaid_trips.driver_id].first_name ?? ""} ${profiles[r.medicaid_trips.driver_id].last_name ?? ""}`.trim()
        : "—",
      pickup_at: r.medicaid_trips?.pickup_at,
      pickup_address: r.medicaid_trips?.pickup_address,
      dropoff_address: r.medicaid_trips?.dropoff_address,
    }));
  });

/* ---------- DETAIL ---------- */

export const getBillingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `*, medicaid_trips(*, riders(full_name, medicaid_id, dob, last_4_ssn, phone, address))`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const trip = rec.medicaid_trips as any;

    let driver_name = "—";
    if (trip?.driver_id) {
      const { data: p } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", trip.driver_id)
        .maybeSingle();
      if (p) driver_name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    }

    let signature_url: string | null = null;
    if (trip?.signature_path) {
      const { data: sig } = await supabase.storage
        .from("signatures")
        .createSignedUrl(trip.signature_path, 60 * 15);
      signature_url = sig?.signedUrl ?? null;
    }
    let pdf_url: string | null = null;
    if (trip?.state_pdf_path) {
      const { data: pdf } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(trip.state_pdf_path, 60 * 15);
      pdf_url = pdf?.signedUrl ?? null;
    }

    const { data: audit } = await supabase
      .from("billing_audit_log")
      .select("id, action, actor_type, notes, created_at")
      .eq("billing_record_id", data.id)
      .order("created_at", { ascending: false });

    return { record: rec, trip, driver_name, signature_url, pdf_url, audit: audit ?? [] };
  });

/* ---------- REVIEW ACTIONS ---------- */

async function logAudit(
  supabase: any,
  billing_record_id: string,
  actor_id: string,
  action: string,
  notes?: string | null,
  actor_type: "admin" | "driver" | "system" = "admin",
) {
  await supabase.from("billing_audit_log").insert({
    billing_record_id,
    action,
    actor_id,
    actor_type,
    notes: notes ?? null,
  });
}

export const approveBillingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { error } = await supabase
      .from("billing_records")
      .update({
        status: "pending_submit",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        fix_notes: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "approved");
    return { ok: true };
  });

export const requestFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: rec, error: recErr } = await supabase
      .from("billing_records")
      .select("id, trip_id, medicaid_trips(driver_id)")
      .eq("id", data.id)
      .single();
    if (recErr) throw new Error(recErr.message);

    const { error } = await supabase
      .from("billing_records")
      .update({
        status: "needs_fix",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        fix_notes: data.notes,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Also flip the trip back to needs_fix so it re-appears for the driver
    await supabase
      .from("medicaid_trips")
      .update({ status: "needs_fix", review_notes: data.notes })
      .eq("id", rec.trip_id);

    await logAudit(supabase, data.id, userId, "needs_fix", data.notes);

    // Send driver an in-app message
    const driverUserId = (rec.medicaid_trips as any)?.driver_id;
    if (driverUserId) {
      const { data: driver } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", driverUserId)
        .maybeSingle();
      if (driver?.id) {
        await supabase.from("messages").insert({
          driver_id: driver.id,
          sender_id: userId,
          sender_role: "admin",
          receiver_id: driverUserId,
          body: `Trip needs fix: ${data.notes}`,
        });
      }
    }

    return { ok: true };
  });

export const markApproved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("billing_records")
      .update({ status: "approved" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "marked_approved");
    return { ok: true };
  });

export const markRejected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("billing_records")
      .update({ status: "rejected", rejection_reason: data.reason })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "marked_rejected", data.reason);
    return { ok: true };
  });

/* ---------- SUBMIT (calls edge function) ---------- */

export const submitBillingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

    // Forward the caller's bearer so the edge function knows who called it
    const authHeader =
      (await import("@tanstack/react-start/server")).getRequestHeader?.(
        "authorization",
      ) ?? "";

    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/submit-to-state-portal`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: authHeader || `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ billing_record_ids: data.ids }),
      },
    );

    const text = await res.text();
    if (!res.ok) throw new Error(text || `Edge function failed (${res.status})`);
    return JSON.parse(text || "{}");
  });

/* ---------- PORTAL CREDENTIALS ---------- */

export const listPortalCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("state_portal_credentials")
      .select(
        "id, portal_id, portal_name, state, login_email, password_last4, last_used_at, updated_at, company_id",
      )
      .order("portal_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertPortalCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        portal_id: z.string().min(1),
        portal_name: z.string().min(1),
        state: z.string().min(2),
        login_email: z.string().email(),
        login_password: z.string().min(1),
        company_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: id, error } = await supabase.rpc("upsert_portal_credential", {
      _portal_id: data.portal_id,
      _portal_name: data.portal_name,
      _state: data.state,
      _login_email: data.login_email,
      _login_password: data.login_password,
      _company_id: (data.company_id ?? undefined) as string | undefined,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

/* ---------- BILLING SETTINGS ---------- */

export const getBillingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("billing_settings")
      .select("id, company_id, default_portal_id")
      .is("company_id", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const runner_configured = Boolean(
      process.env.AUTOMATION_SERVICE_URL &&
        process.env.AUTOMATION_SERVICE_API_KEY &&
        process.env.AUTOMATION_SERVICE_HMAC_SECRET,
    );
    return {
      default_portal_id: data?.default_portal_id ?? null,
      runner_configured,
    };
  });

export const setDefaultBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ portal_id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.rpc("set_default_billing_portal", {
      _portal_id: data.portal_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
