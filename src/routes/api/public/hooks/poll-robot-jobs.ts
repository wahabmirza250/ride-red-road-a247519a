/**
 * BACKGROUND ROBOT POLLER (cron).
 *
 * Reconciles every in-flight portal submission and releases each company's
 * queue, independent of anyone having the billing app open. Called every
 * minute by pg_cron with the project's publishable key in `apikey`.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/poll-robot-jobs")({
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
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sweepRobotJobs } = await import("@/lib/robotQueue.server");

        // Each company has its own portal account, so queues are per company.
        const { data: rows, error } = await supabaseAdmin
          .from("billing_records")
          .select("company_id, status")
          .in("status", ["submitting", "queued"]);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const companies = [...new Set((rows ?? []).map((r: any) => r.company_id))];
        const results: any[] = [];
        for (const companyId of companies) {
          try {
            const out = await sweepRobotJobs(supabaseAdmin, null as any, companyId, { refill: true });
            results.push({ company_id: companyId, ...out });
          } catch (e: any) {
            results.push({ company_id: companyId, error: e?.message ?? "sweep failed" });
          }
        }

        return new Response(JSON.stringify({ ok: true, companies: results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
