import { assertCompanyActive } from './company.server';

/** A ride identifier is a locator, never an authorization credential. */
export async function requireRideAccess(userId: string, requestId: string, staffOnly = false) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const company = await assertCompanyActive(userId);
  const { data: ride, error } = await supabaseAdmin.from('ride_requests')
    .select('id, company_id, passenger_id, driver_id').eq('id', requestId)
    .eq('company_id', company.id).maybeSingle();
  if (error || !ride) throw new Error('Ride unavailable for this account.');
  const { data: roles, error: roleError } = await supabaseAdmin.from('user_roles')
    .select('role').eq('user_id', userId).eq('company_id', company.id);
  if (roleError) throw new Error('Unable to verify ride access.');
  if (roles?.some(r => r.role === 'admin' || r.role === 'dispatch')) return ride;
  if (!staffOnly && ride.passenger_id === userId && roles?.some(r => r.role === 'passenger')) return ride;
  if (!staffOnly && ride.driver_id && roles?.some(r => r.role === 'driver')) {
    const { data: driver } = await supabaseAdmin.from('drivers').select('id')
      .eq('id', ride.driver_id).eq('user_id', userId).eq('company_id', company.id).maybeSingle();
    if (driver) return ride;
  }
  throw new Error('Ride unavailable for this account.');
}
