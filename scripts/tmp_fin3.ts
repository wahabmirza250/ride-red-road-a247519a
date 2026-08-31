import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { applyLiveLinks } from "@/lib/reconcileSweep";
import { decideAutoFinalize } from "@/lib/sweepAutoFinalize";
import { liveLinkMap, finalizeSingleMatch } from "@/lib/reconcileSweep.server";

const IDS = ["def99053-ede0-4ac4-99eb-3810f4d1f367","db8ab4bd-6565-4381-81b5-a42898d991a1","15a4d2f2-d58f-4acb-bd92-dcb25c9f6feb"];
const EXPECT: Record<string,string> = {
  "def99053-ede0-4ac4-99eb-3810f4d1f367":"2326241001170",
  "db8ab4bd-6565-4381-81b5-a42898d991a1":"2326241001103",
  "15a4d2f2-d58f-4acb-bd92-dcb25c9f6feb":"2326241001179",
};
const APPLY = process.argv.includes("--apply");

const { data } = await sb.from("claim_reconcile_results")
  .select("id, billing_record_id, company_id, member_id, service_date, outcome, candidates, confirmed_at")
  .in("id", IDS);
const raws = (data ?? []).map((r: any) => ({ ...r, candidates: Array.isArray(r.candidates) ? r.candidates : [] }));
const rows = applyLiveLinks(raws, await liveLinkMap(sb, "11111111-2222-4333-8444-555555555555", raws));

for (const row of rows) {
  const d = decideAutoFinalize(row as any, { companyId: "11111111-2222-4333-8444-555555555555" });
  if (!d.ok) { console.log("SKIP", row.id, d.reason); continue; }
  if (d.claim.claim_id !== EXPECT[row.id]) { console.log("SKIP", row.id, "claim changed", d.claim.claim_id); continue; }
  const { data: br } = await sb.from("billing_records").select("status, state_confirmation_number, failure_code").eq("id", row.billing_record_id).maybeSingle();
  if (br?.state_confirmation_number) { console.log("SKIP", row.id, "bill already has claim"); continue; }
  console.log(APPLY ? "APPLY" : "DRY", row.id, row.billing_record_id, d.claim.claim_id, d.status, d.claim.paid_amount, br?.failure_code);
  if (APPLY) {
    await finalizeSingleMatch(sb, { resultId: row.id, recordId: row.billing_record_id, claim: d.claim, status: d.status, actorId: null });
    console.log("  finalized");
  }
}
