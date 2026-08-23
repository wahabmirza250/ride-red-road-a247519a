/**
 * SUBMISSION QUEUE SCHEDULER (cron).
 *
 * One bounded tick per call: self-heal abandoned leases, reconcile in-flight
 * robot jobs, then lease and dispatch a bounded batch of queued bills within
 * the per-company and global concurrency caps. Every company is processed, so
 * one tenant's backlog can never starve another.
 *
 * Called every minute by pg_cron with the project's publishable key in `apikey`.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/submission-queue-tick")({
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
        const { runSubmissionQueueTick, isSubmissionQueuePaused, SUBMIT_RUN_BUDGET_MS } =
          await import("@/lib/submissionQueue.server");

        // Paused-state guard at the entry point: the scheduler keeps firing
        // regardless of queue state, so this is what actually stops the work.
        const { paused, reason } = await isSubmissionQueuePaused(supabaseAdmin);
        if (paused) {
          return new Response(JSON.stringify({ ok: true, paused: true, reason }), {
            headers: { "Content-Type": "application/json" },
          });
        }

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
        const started = Date.now();
        const budget = SUBMIT_RUN_BUDGET_MS();
        const results: any[] = [];
        for (const companyId of companies) {
          // Bounded tick: stop cleanly well inside the platform timeout and let
          // the next minute pick up the rest. Nothing is lost — all state is in
          // the database.
          if (Date.now() - started > budget) {
            results.push({ deferred: companies.length - results.length });
            break;
          }
          try {
            const out = await runSubmissionQueueTick(supabaseAdmin, {
              actorId: null,
              companyId,
              worker: `cron-${started}`,
            });
            results.push({ company_id: companyId, ...out });
          } catch (e: any) {
            results.push({ company_id: companyId, error: e?.message ?? "tick failed" });
          }
        }

        return new Response(
          JSON.stringify({ ok: true, ms: Date.now() - started, companies: results }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
