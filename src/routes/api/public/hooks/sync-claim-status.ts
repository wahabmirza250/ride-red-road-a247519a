/**
 * SCHEDULED CLAIM STATUS SYNC (cron) — READ-ONLY.
 *
 * Runs on its own schedule, separate from the submission poller. It only reads
 * claim statuses from the portal and updates our records to match; it never
 * submits, confirms or resubmits anything.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/hooks/sync-claim-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
        if (!key || !expected || key !== expected) {
          return json({ error: "Unauthorized" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runClaimStatusSync } = await import("@/lib/claimStatusSync.server");

        try {
          const result = await runClaimStatusSync(supabaseAdmin);
          return json(result, result.ok ? 200 : 500);
        } catch (e: any) {
          return json({ ok: false, error: e?.message ?? "sync failed" }, 500);
        }
      },
    },
  },
});
