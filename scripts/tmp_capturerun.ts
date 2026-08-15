import { createClient } from "@supabase/supabase-js";
import { startRobotSubmission } from "../src/lib/billingHelpers";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const TRIP = "192af889-c34c-468c-8b75-85da034ccede";
const ACTOR = "ef656627-9699-4a35-a741-0e0767e5d295";

const { data: trip, error } = await supabase
  .from("medicaid_trips")
  .select("*, riders(medicaid_id, full_name)")
  .eq("id", TRIP)
  .single();
if (error) throw error;
console.log("member id:", (trip as any).riders?.medicaid_id);

const { data: rec } = await supabase
  .from("billing_records")
  .select("id, status")
  .eq("trip_id", TRIP)
  .single();
console.log("record", rec);

const started = Date.now();
await startRobotSubmission(supabase, {
  billingRecordId: (rec as any).id,
  trip,
  providerUserId: ACTOR,
  mode: "capture",
});

const { data: t2 } = await supabase
  .from("medicaid_trips")
  .select("robot_job_id")
  .eq("id", TRIP)
  .single();
const jobId = (t2 as any).robot_job_id;
console.log("job", jobId);

const base = "https://redart-hcpf-automation-production.up.railway.app";
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const res = await fetch(`${base}/job-status/${jobId}`);
  const j: any = await res.json().catch(() => ({}));
  console.log(i, j.status, j.message ?? "");
  if (j.status && !["running", "started", "pending", "queued", "in_progress"].includes(j.status)) {
    console.log(JSON.stringify(j, null, 2).slice(0, 6000));
    break;
  }
}
console.log("elapsed s:", Math.round((Date.now() - started) / 1000));
