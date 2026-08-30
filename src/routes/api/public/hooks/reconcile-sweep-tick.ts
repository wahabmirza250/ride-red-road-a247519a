/**
 * SCHEDULED BULK RECONCILIATION SWEEP (cron) — READ-ONLY.
 *
 * Runs the trip-scoped HCPF lookup for bills that look submitted but carry no
 * claim number. It never submits, resubmits, edits or moves a bill; it only
 * stores candidates for a biller to confirm.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/hooks/reconcile-sweep-tick")({
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSweepTick } = await import("@/lib/reconcileSweep.server");
        try {
          const result = await runSweepTick(supabaseAdmin);
          return json(result, result.ok ? 200 : 500);
        } catch (e: any) {
          return json({ ok: false, error: e?.message ?? "sweep failed" }, 500);
        }
      },
    },
  },
});
