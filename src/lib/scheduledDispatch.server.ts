let started = false, running = false;
async function sweep() {
  if (running) return;
  running = true;
  try {
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { dispatchRideInternal } = await import('./dispatchEngine.server');
    const { data, error } = await db.from('ride_requests').select('id')
      .eq('status','pending').is('driver_id',null).not('requested_pickup_time','is',null)
      .lte('requested_pickup_time',new Date(Date.now()+15*60_000).toISOString())
      .gte('requested_pickup_time',new Date(Date.now()-60*60_000).toISOString())
      .order('requested_pickup_time').limit(100);
    if (error) throw error;
    for (const ride of data ?? []) await dispatchRideInternal({request_id:ride.id,quiet:true});
  } catch { console.error('Scheduled dispatch check failed; retrying next minute.'); }
  finally { running=false; }
}
export function startScheduledDispatch() {
  if (started || process.env.NODE_ENV!=='production') return;
  started=true; void sweep(); setInterval(()=>void sweep(),60_000).unref();
}
