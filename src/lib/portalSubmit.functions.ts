import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac, randomUUID } from "crypto";

const InputSchema = z.object({ tripId: z.string().uuid() });

/**
 * Kicks off the automated Colorado Health First provider-portal submission
 * for a reviewed medicaid trip. Requires the caller to be an admin.
 *
 * Flow:
 *   1. Verify caller is admin.
 *   2. Verify the trip is in status "approved" (human already reviewed).
 *   3. Generate short-lived signed URLs for the PDF + rider signature.
 *   4. Sign the payload with HFC_RUNNER_HMAC_SECRET and POST to
 *      $HFC_RUNNER_URL/submit.
 *   5. Mark portal_status = "submitting"; the runner posts back to
 *      /api/public/hfc-callback when done.
 */
export const submitTripToPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const runnerUrl = process.env.HFC_RUNNER_URL;
    const hmacSecret = process.env.HFC_RUNNER_HMAC_SECRET;
    if (!runnerUrl) throw new Error("HFC_RUNNER_URL not configured. Deploy the runner and set the secret first.");
    if (!hmacSecret) throw new Error("HFC_RUNNER_HMAC_SECRET missing");

    // Load trip + rider (server-side auth = admin, RLS applies)
    const { data: trip, error } = await supabase
      .from("medicaid_trips")
      .select("*, riders(*)")
      .eq("id", data.tripId)
      .single();
    if (error || !trip) throw new Error(error?.message ?? "Trip not found");
    if (trip.status !== "approved") throw new Error("Trip must be approved before submission");

    // Signed URLs (15 min) so the runner can download the signed state PDF
    // and rider signature to attach in the portal.
    let signatureUrl: string | null = null;
    if (trip.signature_path) {
      const { data: sig } = await supabase.storage
        .from("signatures")
        .createSignedUrl(trip.signature_path, 60 * 15);
      signatureUrl = sig?.signedUrl ?? null;
    }
    let pdfUrl: string | null = null;
    if (trip.state_pdf_path) {
      const { data: pdf } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(trip.state_pdf_path, 60 * 15);
      pdfUrl = pdf?.signedUrl ?? null;
    }
    if (!pdfUrl) {
      throw new Error(
        "This trip has no stored state PDF yet. Ask the driver to re-submit so the PDF is generated.",
      );
    }

    const runId = randomUUID();
    const payload = {
      run_id: runId,
      submission_id: trip.id,
      callback_url: `${process.env.SITE_URL ?? ""}/api/public/hfc-callback`,
      member: {
        health_first_id: trip.riders?.medicaid_id,
        full_name: trip.riders?.full_name,
        dob: trip.riders?.dob,
      },
      trip: {
        date: trip.pickup_at,
        pickup_address: trip.pickup_address,
        dropoff_address: trip.dropoff_address,
        odometer_start: trip.odometer_start,
        odometer_end: trip.odometer_end,
        miles: trip.miles,
      },
      signature_url: signatureUrl,
      pdf_url: pdfUrl,
      evidence_prefix: `${trip.id}/${runId}`,
      issued_at: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", hmacSecret).update(body).digest("hex");

    const resp = await fetch(`${runnerUrl.replace(/\/$/, "")}/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hfc-signature": sig,
      },
      body,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Runner rejected: ${resp.status} ${txt}`);
    }

    await supabase
      .from("medicaid_trips")
      .update({
        portal_status: "submitting",
        portal_run_id: runId,
        portal_evidence_prefix: payload.evidence_prefix,
        portal_error: null,
      })
      .eq("id", trip.id);

    return { ok: true, run_id: runId };
  });
