import {robotReceiptEvidence} from './robotReceiptEvidence';
import {robotServiceHeaders} from './robotServiceAuth.server';

let started=false;
let running=false;
/** Receipt collection only. No portal login, queue dispatch, retry or submission. */
export async function collectRobotReceipts() {
  if (running) return;
  running=true;
  try {
    const {supabaseAdmin:db} = await import('@/integrations/supabase/client.server');
    const {pollBaseUrlFor} = await import('@/lib/robotFleet.server');
    // Rollout is limited to the company whose missing receipts were reported.
    const companyId='c246bbf7-a748-47cc-b1b4-a723395567a8';
    const {data:rows,error}=await db.from('billing_records')
      .select('id,trip_id,state_confirmation_number,resubmission_id,medicaid_trips!inner(robot_job_id,robot_worker_id,robot_worker_url,robot_confirmation_number)')
      .eq('company_id',companyId).eq('status','submitting').is('resubmission_id',null).limit(30);
    if(error) throw error;
    for (const row of rows ?? []) {
      const trip:any=row.medicaid_trips;
      if(!trip?.robot_job_id || row.state_confirmation_number) continue;
      try {
        const response=await fetch(`${pollBaseUrlFor(trip)}/job-status/${encodeURIComponent(trip.robot_job_id)}`,{
          method:'GET',headers:robotServiceHeaders(),signal:AbortSignal.timeout(10000)
        });
        if(!response.ok) continue;
        const receipt=robotReceiptEvidence(await response.json(),{jobId:trip.robot_job_id,companyId,tripId:row.trip_id});
        if(!receipt || (trip.robot_confirmation_number && trip.robot_confirmation_number!==receipt.id)) continue;
        const now=new Date().toISOString();
        const {data:changed,error:tripError}=await db.from('medicaid_trips').update({
          status:'submitted',robot_last_status:'SUBMITTED',robot_confirmation_number:receipt.id,
          submitted_confirmation:receipt.id,portal_confirmation:receipt.id,
          portal_status:receipt.suspended?'suspended':'submitted',
          portal_submitted_at:receipt.finishedAt,submitted_at:receipt.finishedAt,
          robot_last_checked_at:now,robot_last_message:`Submitted. Portal confirmation #${receipt.id}${receipt.suspended?' (portal suspended)':''}`
        }).eq('id',row.trip_id).eq('company_id',companyId).eq('robot_job_id',trip.robot_job_id)
          .or(`robot_confirmation_number.is.null,robot_confirmation_number.eq.${receipt.id}`).select('id');
        if(tripError) throw tripError;
        if(!changed?.length) continue;
        const {data:saved,error:billError}=await db.from('billing_records').update({
          status:receipt.suspended?'suspended':'submitted',state_confirmation_number:receipt.id,
          submitted_at:receipt.finishedAt,submission_error:null,requires_human_step:false,
          status_check_next_at:now,status_check_attempts:0,status_check_error:null
        }).eq('id',row.id).eq('company_id',companyId).eq('status','submitting')
          .is('state_confirmation_number',null).select('id');
        if(billError) throw billError;
        if(saved?.length) {
          const {error:auditError}=await db.from('billing_audit_log').insert({billing_record_id:row.id,
            action:'robot_receipt_collected',actor_type:'system',
            notes:`Verified completed job ${trip.robot_job_id}; claim #${receipt.id}; portal suspended=${receipt.suspended}. Receipt-only sync; no submission request sent.`});
          if(auditError) console.error('ROBOT_RECEIPT_AUDIT_FAILED',row.id,auditError.message);
          console.info('ROBOT_RECEIPT_SAVED',row.id,receipt.id);
        }
      } catch(error:any) { console.error('ROBOT_RECEIPT_CHECK_FAILED',row.id,error?.message); }
    }
  } finally { running=false; }
}
export function startRobotReceiptSync() {
  if(started || process.env.NODE_ENV!=='production') return;
  started=true;
  const tick=()=>void collectRobotReceipts().catch(error=>console.error('ROBOT_RECEIPT_SYNC_FAILED',error?.message));
  tick();
  setInterval(tick,30000).unref();
}
