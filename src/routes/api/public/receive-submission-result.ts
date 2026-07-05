import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

// Automation service posts here when a submission finishes (success or failure).
// Auth: HMAC-SHA256 of raw body using AUTOMATION_SERVICE_HMAC_SECRET, sent in x-signature.

const Body = z.object({
  billing_record_id: z.string().uuid(),
  success: z.boolean(),
  state_confirmation_number: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
});

export const Route = createFileRoute("/api/public/receive-submission-result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.AUTOMATION_SERVICE_HMAC_SECRET;
        if (!secret) return new Response("misconfigured", { status: 500 });

        const raw = await request.text();
        const provided = request.headers.get("x-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = Body.parse(JSON.parse(raw));
        } catch (e: any) {
          return new Response(`bad payload: ${e.message}`, { status: 400 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        if (parsed.success) {
          const { error } = await supabaseAdmin
            .from("billing_records")
            .update({
              status: "submitted",
              state_confirmation_number: parsed.state_confirmation_number ?? null,
              submitted_at: new Date().toISOString(),
              submission_error: null,
            })
            .eq("id", parsed.billing_record_id);
          if (error) return new Response(error.message, { status: 500 });

          await supabaseAdmin.from("billing_audit_log").insert({
            billing_record_id: parsed.billing_record_id,
            action: "submitted",
            actor_type: "system",
            notes: parsed.state_confirmation_number ?? null,
          });
        } else {
          const msg = parsed.error_message ?? "Submission failed";
          const { error } = await supabaseAdmin
            .from("billing_records")
            .update({
              status: "pending_submit",
              submission_error: msg,
            })
            .eq("id", parsed.billing_record_id);
          if (error) return new Response(error.message, { status: 500 });

          await supabaseAdmin.from("billing_audit_log").insert({
            billing_record_id: parsed.billing_record_id,
            action: "submit_failed",
            actor_type: "system",
            notes: msg,
          });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
