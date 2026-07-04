import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

// Runner posts back here when submission finishes (or needs MFA).
// Auth: HMAC signature of raw body using HFC_RUNNER_HMAC_SECRET.

const CallbackSchema = z.object({
  run_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  status: z.enum(["submitted", "failed", "needs_mfa"]),
  confirmation: z.string().nullable().optional(),
  mfa_prompt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  evidence_prefix: z.string().nullable().optional(),
});

export const Route = createFileRoute("/api/public/hfc-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.HFC_RUNNER_HMAC_SECRET;
        if (!secret) return new Response("misconfigured", { status: 500 });

        const raw = await request.text();
        const provided = request.headers.get("x-hfc-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = CallbackSchema.parse(JSON.parse(raw));
        } catch (e: any) {
          return new Response(`bad payload: ${e.message}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const updates: Partial<Record<string, unknown>> = {
          portal_status: parsed.status,
          portal_error: parsed.error ?? null,
          portal_mfa_prompt: parsed.mfa_prompt ?? null,
        };
        if (parsed.status === "submitted") {
          updates.portal_confirmation = parsed.confirmation ?? null;
          updates.portal_submitted_at = new Date().toISOString();
          updates.status = "submitted";
          updates.submitted_confirmation = parsed.confirmation ?? null;
          updates.submitted_at = new Date().toISOString();
        }
        if (parsed.evidence_prefix) updates.portal_evidence_prefix = parsed.evidence_prefix;

        const { error } = await supabaseAdmin
          .from("medicaid_trips")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(updates as any)
          .eq("id", parsed.submission_id)
          .eq("portal_run_id", parsed.run_id);

        if (error) return new Response(error.message, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
