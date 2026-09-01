/**
 * READ-ONLY VERIFICATION TICK FOR HELD CORRECTED RESUBMISSIONS.
 *
 * Runs `verifyHeldCorrectedRecords`, which searches HCPF by member Medicaid ID
 * + corrected service date and attaches a claim ONLY when exactly one unused
 * claim exists whose id differs from the original denied claim.
 *
 * It never submits, resubmits, recreates or retries a held job, and never
 * touches the original denied billing record.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/hooks/corrected-verify-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
        if (!key || !expected || key !== expected) return json({ error: "Unauthorized" }, 401);

        const payload = (await request.json().catch(() => ({}))) as {
          record_ids?: unknown;
          company_id?: unknown;
          limit?: unknown;
        };
        const recordIds = Array.isArray(payload.record_ids)
          ? payload.record_ids.map((v) => String(v)).filter(Boolean)
          : null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifyHeldCorrectedRecords } = await import("@/lib/correctedVerify.server");
        try {
          const summary = await verifyHeldCorrectedRecords(supabaseAdmin, {
            recordIds,
            companyId: payload.company_id ? String(payload.company_id) : null,
            limit: Number(payload.limit) > 0 ? Number(payload.limit) : recordIds?.length || 10,
          });
          return json({ ok: true, ...summary });
        } catch (e: any) {
          return json({ ok: false, error: e?.message ?? "verification failed" }, 500);
        }
      },
    },
  },
});
