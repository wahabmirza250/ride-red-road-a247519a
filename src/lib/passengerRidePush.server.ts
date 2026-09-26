import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { isRidePushStatus, ridePushMessages } from './passengerRidePush';
import { sendPushToUsers } from './pushSend.server';

// The outbox is private and accessed only by this service-role worker.
const db: SupabaseClient = supabaseAdmin;
type Event = {id:string;company_id:string;user_id:string;source_type:'trip'|'request';source_id:string;status:string;driver_id:string|null};
let started = false;
let running = false;

export async function deliverPassengerRidePush(event: Event) {
  if (!isRidePushStatus(event.status)) return 'obsolete';
  const {data:company,error:companyError} = await db.from('companies').select('url_slug,status').eq('id',event.company_id).maybeSingle();
  if (companyError) throw companyError;
  if (company?.status !== 'active') return 'obsolete';
  const {data:profile,error:profileError} = await db.from('profiles').select('company_id,is_active').eq('id',event.user_id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active || profile.company_id !== event.company_id) return 'obsolete';
  const {data:role,error:roleError} = await db.from('user_roles').select('role').eq('user_id',event.user_id).eq('company_id',event.company_id).eq('role','passenger').maybeSingle();
  if (roleError) throw roleError;
  if (!role) return 'obsolete';
  const table = event.source_type === 'trip' ? 'trips' : 'ride_requests';
  const {data:ride,error:rideError} = await db.from(table).select('status,driver_id,passenger_id').eq('id',event.source_id).eq('company_id',event.company_id).maybeSingle();
  if (rideError) throw rideError;
  // Do not tell a passenger an old driver is arriving after reassignment/cancellation.
  if (!ride || ride.status !== event.status || ride.driver_id !== event.driver_id) return 'obsolete';
  if (event.source_type === 'trip') {
    const {data:pax,error} = await db.from('passengers').select('user_id').eq('id',ride.passenger_id).eq('company_id',event.company_id).maybeSingle();
    if (error) throw error;
    if (pax?.user_id !== event.user_id) return 'obsolete';
  } else if (ride.passenger_id !== event.user_id) return 'obsolete';
  const [title,body] = ridePushMessages[event.status];
  const result = await sendPushToUsers([event.user_id], {
    title,body,rideStatus:event.status,url:`/${company.url_slug}/passenger/track`,tag:`ride-${event.source_id}`,
  });
  if (result.sent > 0) return 'sent';
  if (result.failed > 0) throw new Error('Ride notification delivery failed');
  // Keep retrying briefly: the app may be registering its token during sign-in.
  throw new Error('Passenger has no registered notification device');
}

export async function drainPassengerRidePush() {
  if (running || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return;
  running = true;
  try {
    for (let i=0;i<10;i++) {
      const {data,error} = await db.rpc('claim_passenger_ride_push');
      if (error) throw error;
      const event = data?.[0] as Event | undefined;
      if (!event) break;
      try {
        const outcome = await deliverPassengerRidePush(event);
        const {error:saveError} = await db.from('ride_push_outbox').update({sent_at:new Date().toISOString(),outcome}).eq('id',event.id);
        if (saveError) throw saveError;
      } catch { console.warn('Passenger ride notification pending retry.'); }
    }
    const {error} = await db.from('ride_push_outbox').delete().lt('created_at',new Date(Date.now()-7*86400000).toISOString());
    if (error) throw error;
  } finally { running=false; }
}

export function startPassengerRidePush() {
  if (started || process.env.NODE_ENV !== 'production') return;
  started = true;
  const run = () => void drainPassengerRidePush().catch(()=>console.error('Passenger notification queue unavailable; retrying.'));
  run();
  setInterval(run,10000).unref();
}
