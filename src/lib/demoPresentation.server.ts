import { createHash } from 'node:crypto';
import { createDemoBillPdf } from './demoDocuments';

export const DEMO_PRESENTATION_VERSION = 'presentation_v2';
export function demoId(company: string, key: string) {
  const h = createHash('sha256').update(`${company}:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function read(query: any) {
  const {data,error} = await query;
  if(error) throw new Error(`Demo presentation: ${error.message}`);
  return data;
}
export function presentationKey(companyId: string) { return `company:${companyId}:${DEMO_PRESENTATION_VERSION}`; }

/** One-time versioned upgrade. Only deterministic sample IDs are edited, never customer records. */
export async function seedDemoPresentation(db: any, companyId: string, ownerId: string,
  users: {id: string; name: string}[], now = new Date()) {
  const company = await read(db.from('companies').select('is_demo,demo_owner_id').eq('id',companyId).single());
  if(company?.is_demo !== true || company.demo_owner_id !== ownerId) throw new Error('Verified demo ownership required.');
  if(await read(db.from('app_settings').select('value').eq('key',presentationKey(companyId)).maybeSingle())) return false;
  const id = (key:string)=>demoId(companyId,key);
  const at = (hours:number)=>new Date(now.getTime()+hours*3600000).toISOString();
  const day = (hours:number)=>at(hours).slice(0,10);
  const presenter = users[0].id;
  const driverRows: any[] = [];
  for(const [i,user] of users.entries()) {
    const existing = await read(db.from('drivers').select('id').eq('user_id',user.id).eq('company_id',companyId).maybeSingle());
    const driverId = existing?.id ?? id(`driver-${i}`);
    const driver = {id:driverId,user_id:user.id,company_id:companyId,vehicle_make:'Ford',vehicle_model:'Transit',vehicle_year:2024,
      vehicle_plate:`DEMO-${i+12}`,unit_number:String(i+12),default_vehicle_type:'ambulatory',default_plate:`DEMO-${i+12}`,
      current_lat:38.83+i*.008,current_lng:-104.82+i*.006,last_location_at:at(0),rating:4.9,total_trips:24+i*8};
    // Existing drivers may be in a trip started by the presenter. Preserve their status.
    await read(db.from('drivers').upsert(existing ? driver : {...driver,status:'available'}));
    driverRows.push({...driver,name:user.name});
    await read(db.from('driver_pay_plans').upsert({driver_id:driverId,company_id:companyId,plan:'hourly',hourly_rate:22+i,per_trip_source:'completed_trips'}));
    const payoutId=id(`presentation-payout-${i}`);
    await read(db.from('driver_payouts').upsert({id:payoutId,company_id:companyId,driver_id:driverId,
      period_start:at(-168),period_end:at(-144),hours:8,hourly_rate:22+i,hourly_pay:8*(22+i),gross_earnings:8*(22+i),total_paid:8*(22+i),
      fuel_reimbursed:0,method:'manual',reference:`DEMO-PAY-${i+1}`,notes:'Simulated payroll only. No funds transferred.',paid_by:presenter,paid_at:at(-120),plan:'hourly',shift_count:1}));
    await read(db.from('driver_shifts').upsert({id:id(`presentation-paid-shift-${i}`),driver_id:driverId,company_id:companyId,
      clock_in_at:at(-160),clock_out_at:at(-152),start_odometer:24000,end_odometer:24096,hourly_rate_snapshot:22+i,earnings:8*(22+i),payout_id:payoutId,cleared_at:at(-120)}));
    await read(db.from('driver_shifts').upsert({id:id(`presentation-unpaid-shift-${i}`),driver_id:driverId,company_id:companyId,
      clock_in_at:at(-24),clock_out_at:at(-18),start_odometer:24800,end_odometer:24872,hourly_rate_snapshot:22+i,earnings:6*(22+i)}));
    await read(db.from('shifts').upsert({id:id(`presentation-schedule-${i}`),driver_id:driverId,shift_date:day(24),start_time:at(24),end_time:at(32),status:'scheduled',notes:'Demo transport shift'}));
    await read(db.from('driver_insurance_docs').upsert({id:id(`presentation-insurance-${i}`),company_id:companyId,driver_id:driverId,
      insurer:'Fictional Demo Insurer',policy_number:`DEMO-POLICY-${i+1}`,vehicle_label:'Ford Transit',vehicle_plate:driver.vehicle_plate,
      effective_date:day(-720),expiration_date:day(4320),status:'verified',verified_by:presenter,verified_at:at(-24),created_by:presenter,notes:'Sample compliance record. Not an insurance policy.'}));
    await read(db.from('vehicle_expenses').upsert({id:id(`presentation-expense-${i}`),company_id:companyId,driver_id:driverId,
      vehicle_label:'Ford Transit',vehicle_plate:driver.vehicle_plate,expense_date:day(-24),category:'maintenance',amount:75+i*10,
      odometer:24872,vendor:'Demo Service Center',notes:'Fictional routine service expense',created_by:presenter}));
  }
  await read(db.from('company_pay_settings').upsert({company_id:companyId,default_plan:'hourly',hourly_rate:22,per_trip_source:'completed_trips'}));
  // Move untouched starter bookings into tomorrow, freeing today's dispatch demonstration.
  for(let i=6;i<12;i++) await read(db.from('trips').update({driver_id:driverRows[1+(i% (driverRows.length-1))].id,
    status:'scheduled',scheduled_pickup_time:at(24+(i-6)*3) }).eq('company_id',companyId).eq('id',id(`trip-${i}`)).in('status',['scheduled','assigned']));
  // Only clear the starter driver's seeded busy state when no actual trip is underway.
  const active = await read(db.from('trips').select('id').eq('company_id',companyId).eq('driver_id',driverRows[0].id)
    .in('status',['assigned','driver_en_route_to_pickup','arrived_at_pickup','in_progress']));
  const accepted = await read(db.from('ride_requests').select('id').eq('company_id',companyId).eq('driver_id',driverRows[0].id).eq('status','accepted'));
  if(!active.length && !accepted.length) await read(db.from('drivers').update({status:'available'}).eq('company_id',companyId).eq('id',driverRows[0].id));
  for(let i=0;i<3;i++) await read(db.from('ride_requests').update({requested_pickup_time:at(1+i*.5)})
    .eq('company_id',companyId).eq('id',id(`request-${i}`)).eq('status','pending').is('driver_id',null));
  const names=['Jordan Lee','Alex Morgan','Sam Taylor','Jamie Parker'];
  const rates=await read(db.from('billing_rate_settings').select('unit_type,charge_amount').is('company_id',null).eq('vehicle_type','ambulatory'));
  const tripRate=Number(rates.find((r:any)=>r.unit_type==='trip')?.charge_amount);
  const mileRate=Number(rates.find((r:any)=>r.unit_type==='mile')?.charge_amount);
  if(!Number.isFinite(tripRate)||!Number.isFinite(mileRate)) throw new Error('Billing rates are needed to prepare matching sample bills.');
  for(let i=0;i<6;i++) {
    const mid=id(`medical-${i}`), driver=driverRows[i%driverRows.length];
    const trip = await read(db.from('medicaid_trips').select('id,rider_id,status,riders(full_name,medicaid_id)').eq('company_id',companyId).eq('id',mid).maybeSingle());
    if(!trip) continue;
    const date=day(-24*(1+Math.floor(i/3)));
    const reference=`DEMO-TRIP-${String(i+1).padStart(3,'0')}`;
    const path=`${presenter}/demo/${mid}/sample-bill.pdf`;
    const document=await createDemoBillPdf({reference,passenger:trip.riders?.full_name??names[i%4],memberId:trip.riders?.medicaid_id??'DEMO',
      driver:driver.name,date,plate:driver.vehicle_plate,pickup:`${10+i%4} Example Lane, Colorado Springs, CO`,dropoff:'Demo Medical Center, Colorado Springs, CO',tripRate,mileRate});
    await read(db.storage.from('state-pdfs').upload(path,document,{contentType:'application/pdf',upsert:true}));
    await read(db.from('medicaid_trips').update({driver_id:driver.user_id,pickup_at:`${date}T14:30:00.000Z`,state_pdf_path:path,
      state_pdf_generated_at:at(0),signature_name:`${names[i%4]} (sample signature)`,vehicle_plate:driver.vehicle_plate,
      review_notes:'Fictional signed sample. Never submit to a payer.'}).eq('company_id',companyId).eq('id',mid));
    await read(db.from('medicaid_trip_legs').update({leg_date:date}).eq('id',id(`leg-${i}`)).eq('medicaid_trip_id',mid));
    await read(db.from('trips').update({driver_id:driver.id,scheduled_pickup_time:`${date}T14:30:00.000Z`,actual_pickup_time:`${date}T14:30:00.000Z`,actual_dropoff_time:`${date}T15:00:00.000Z`})
      .eq('company_id',companyId).eq('id',id(`trip-${i}`)).eq('status','completed'));
    // Give the review, ready, submitted and paid tabs a sample without rewinding existing billing actions.
    const status=i<2?'pending_review':i<4?'approved':i===4?'submitted':'paid';
    const confirmation=`DEMO-CLAIM-${i+1}`;
    await read(db.from('billing_records').update({company_id:companyId,status,fix_notes:null,submission_error:null,
      ...(i>=4?{state_confirmation_number:confirmation,submitted_at:at(-12),edi_environment:'test',edi_status:i===5?'paid':'uploaded',
        edi_status_detail:{demo:true,message:'Simulated sample history. No payer contacted.'}}:{})})
      .eq('company_id',companyId).eq('trip_id',mid).eq('status','pending_review'));
  }
  await read(db.from('events').upsert({id:id('presentation-event'),company_id:companyId,title:'Demo driver safety briefing',
    description:'Sample company event: vehicle checks, passenger assistance and safe pickups.',starts_at:at(48),ends_at:at(49),
    location_address:'Demo Transport Office, Colorado Springs',is_active:true,created_by:presenter}));
  await read(db.from('news_items').upsert({id:id('presentation-news'),company_id:companyId,title:'Welcome to Evergreen Transport',
    body:'Demo announcement: your next trip and assigned driver appear in the passenger app. All records in this company are fictional.',is_active:true}));
  await read(db.from('incidents').upsert({id:id('presentation-incident'),driver_id:driverRows[1].id,incident_type:'mechanical',
    description:'Demo: tire pressure checked before the shift.',status:'closed',admin_notes:'Sample resolution: inspection completed and vehicle cleared.'}));
  await read(db.from('messages').upsert({id:id('presentation-message'),driver_id:driverRows[0].id,sender_id:driverRows[1].user_id,
    sender_role:'driver',receiver_id:presenter,body:'Demo dispatch update: vehicle inspection is complete and I am ready for pickups.',read:false}));
  const conversation=await read(db.from('chat_conversations').select('id').eq('kind','driver_admin').eq('driver_user_id',driverRows[1].user_id).maybeSingle());
  const conversationId=conversation?.id??id('presentation-conversation');
  if(!conversation)await read(db.from('chat_conversations').insert({id:conversationId,kind:'driver_admin',driver_user_id:driverRows[1].user_id,is_closed:false,last_message_at:at(0)}));
  await read(db.from('chat_messages').upsert({id:id('presentation-chat-message'),conversation_id:conversationId,sender_id:driverRows[1].user_id,
    body:'Demo update: vehicle inspection is complete. I am ready for my next pickup.',created_at:at(0)}));
  await read(db.from('company_rewards_settings').upsert({company_id:companyId,enabled:true,rides_required:15,period_type:'weekly',
    prize_description:'Demo recognition award',winners_per_period:1}));
  await read(db.from('app_settings').upsert({key:presentationKey(companyId),value:DEMO_PRESENTATION_VERSION},{onConflict:'key'}));
  return true;
}
