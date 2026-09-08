/**
 * OPERATOR SCRIPT — run the SAFE read-only HCPF reconciliation sweep.
 * Pauses submissions first. Never submits, resubmits or deletes a claim.
 */
import { createClient } from "@supabase/supabase-js";
import { startSweep, runSweepTick, findSweepCandidates } from "@/lib/reconcileSweep.server";

const sb = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Keep submissions paused for the whole operation.
  await sb
    .from("submission_queue_state")
    .update({ paused: true, pause_reason: "Safe read-only reconciliation sweep in progress" })
    .eq("id", true);
  const { data: state } = await sb.from("submission_queue_state").select("paused, pause_reason").maybeSingle();
  console.log("queue:", state);

  // 2. Start / top up a sweep per company that has eligible records.
  const { data: companies } = await sb.from("companies").select("id, name");
  const sweeps: { company: string; id: string; total: number; enqueued: number }[] = [];
  for (const c of (companies ?? []) as any[]) {
    const cands = await findSweepCandidates(sb as any, c.id);
    if (!cands.length) continue;
    const s = await startSweep(sb as any, { companyId: c.id, actorId: null });
    sweeps.push({ company: c.name, id: s.sweep_id, total: s.total, enqueued: s.enqueued });
  }
  console.log("sweeps:", JSON.stringify(sweeps));
  if (!sweeps.length) return;

  // 3. Bounded ticking until terminal.
  const deadline = Date.now() + 9 * 60_000;
  let tick = 0;
  while (Date.now() < deadline) {
    tick += 1;
    const r = await runSweepTick(sb as any);
    const { count: open } = await sb
      .from("claim_reconcile_results")
      .select("id", { count: "exact", head: true })
      .in("sweep_id", sweeps.map((s) => s.id))
      .in("outcome", ["pending", "searching"]);
    console.log(`tick ${tick}`, JSON.stringify(r), "open:", open);
    if (!open) break;
    await sleep(4000);
  }

  // 4. Report.
  const { data: rows } = await sb
    .from("claim_reconcile_results")
    .select("outcome, confirm_kind, error")
    .in("sweep_id", sweeps.map((s) => s.id));
  const tally: Record<string, number> = {};
  const errs: Record<string, number> = {};
  for (const r of (rows ?? []) as any[]) {
    const k = `${r.outcome}${r.confirm_kind ? `/${r.confirm_kind}` : ""}`;
    tally[k] = (tally[k] ?? 0) + 1;
    if (r.error) errs[String(r.error).slice(0, 120)] = (errs[String(r.error).slice(0, 120)] ?? 0) + 1;
  }
  console.log("OUTCOMES", JSON.stringify(tally, null, 2));
  console.log("ERRORS", JSON.stringify(errs, null, 2));
  const { data: sw } = await sb
    .from("claim_reconcile_sweeps")
    .select("id, status, total")
    .in("id", sweeps.map((s) => s.id));
  console.log("SWEEPS", JSON.stringify(sw));
}

main().then(() => process.exit(0), (e) => { console.error("FAILED", e); process.exit(1); });
