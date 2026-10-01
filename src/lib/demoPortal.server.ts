import { assertBillingLimits } from "./billingLimits";
import { isDemoCompany } from "./demoCompany.server";
import { requireCompanyId } from "./company.server";

export async function demoPortalCompany(userId: string) {
  const companyId = await requireCompanyId(userId);
  return await isDemoCompany(companyId) ? companyId : null;
}

/** Presentation records only; no portal, queue, worker or payer calls. */
export async function runDemoPortal(db: any, companyId: string, ids: string[] | undefined, action: "submit" | "payment") {
  if (!await isDemoCompany(companyId)) throw new Error("Simulation is restricted to demo companies.");
  let query = db.from("billing_records").select("id,status,state_confirmation_number,edi_status,medicaid_trips(miles,odometer_start,odometer_end,medicaid_trip_legs(pickup_odometer,dropoff_odometer))").eq("company_id", companyId);
  if (ids) query = query.in("id", ids);
  else query = query.in("status", action === "submit" ? ["pending_review", "approved", "pending_submit", "needs_fix"] : ["submitted"]);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (ids && rows.length !== new Set(ids).size) throw new Error("The selected bills do not belong to this demo company.");
  if (action === "payment" && rows.some((r: any) => !["submitted", "paid"].includes(r.status))) throw new Error("Submit the sample claims first.");
  if (action === "submit") for (const row of rows) {
    const trip = row.medicaid_trips;
    if (trip) assertBillingLimits({miles:trip.miles, odometer_legs:trip.medicaid_trip_legs?.length ? trip.medicaid_trip_legs : [{pickup_odometer:trip.odometer_start,dropoff_odometer:trip.odometer_end}]});
  }
  const now = new Date().toISOString();
  const startedIds: string[] = [];
  for (const row of rows) {
    if (action === "submit" && row.state_confirmation_number) continue;
    const patch = action === "submit" ? {
      status: "submitted", submitted_at: now, state_confirmation_number: `DEMO-${row.id.slice(0,8).toUpperCase()}`,
      requires_human_step: false, submission_error: null, submit_last_error: null, failure_code: null, fix_notes: null,
    } : { status: "paid", edi_environment: "test", edi_status: "paid", edi_status_detail: { demo: true, status: "paid", message: "Sample payment received. No payer contacted." } };
    const { error: updateError } = await db.from("billing_records").update(patch).eq("company_id", companyId).eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    startedIds.push(row.id);
  }
  return { ok: true, demo: true, status: action === "submit" ? "submitted" : "paid", started: startedIds.length, queued: 0, startedIds, skipped: [], duplicates: [], failed: [], batch_id: null };
}
