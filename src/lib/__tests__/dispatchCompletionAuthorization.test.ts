import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, writes: [] as string[], rpc: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  const fn: any = { middleware: () => fn, inputValidator: () => fn, handler: (handler: any) => handler };
  return fn;
} }));
vi.mock('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
vi.mock('../company.server', () => ({ assertCompanyActive: async () => ({id:'company-a'}), getCompanyBySlug: async () => ({id:'company-a',status:'active'}) }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { rpc: state.rpc, from: (table: string) => {
  let rows = state.rows[table] ?? [];
  let patch: any;
  const run = (single = false) => {
    if (patch) { state.writes.push(table); rows.forEach(row => Object.assign(row, patch)); }
    return { data: single ? rows[0] ?? null : rows, error: null };
  };
  const query: any = {
    select: () => query,
    eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
    is: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
    update: (value: unknown) => { patch = value; return query; },
    maybeSingle: async () => run(true),
    then: (resolve: any) => Promise.resolve(run()).then(resolve),
  };
  return query;
} } }));
import { completeDriverDispatchTrip, getVehicleEtas } from '../dispatch.functions';
const complete = () => (completeDriverDispatchTrip as any)({ data: { trip_id: 'trip', request_id: 'ride' }, context: { userId: 'driver-user' } });

describe('dispatch completion authorization before mutation', () => {
  beforeEach(() => {
    state.writes = [];
    state.rpc.mockReset().mockResolvedValue({data: {ok: true}, error: null});
    state.rows = {
      user_roles: [{user_id:'driver-user',company_id:'company-a',role:'driver'}],
      drivers: [{ id: 'driver', user_id: 'driver-user', company_id: 'company-a', status: 'busy' }],
      trips: [{ id: 'trip', driver_id: 'driver', company_id: 'company-a', status: 'in_progress' }],
      ride_requests: [{ id: 'ride', trip_id: 'trip', company_id: 'company-a' }],
    };
  });
  it('denies a revoked driver role even when its driver profile remains', async () => {
    state.rows.user_roles=[];
    await expect(complete()).rejects.toThrow('Driver access required');
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
  it.each(['missing', 'wrong-trip', 'wrong-company'])('makes no writes for a %s request', async kind => {
    if (kind === 'missing') state.rows.ride_requests = [];
    if (kind === 'wrong-trip') state.rows.ride_requests[0].trip_id = 'other';
    if (kind === 'wrong-company') state.rows.ride_requests[0].company_id = 'company-b';
    await expect(complete()).rejects.toThrow();
    expect(state.writes).toEqual([]);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.rows.trips[0].status).toBe('in_progress');
  });
  it('closes the linked trip and ride for the assigned driver', async () => {
    await expect(complete()).resolves.toMatchObject({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('update_company_dispatch_ride', {
      _company_id: 'company-a', _request_id: 'ride', _action: 'complete', _driver_id: 'driver', _trip_id: 'trip',
    });
  });
  it('surfaces a failed transaction', async () => {
    state.rpc.mockResolvedValue({data:null,error:{message:'Ride changed'}});
    await expect(complete()).rejects.toThrow('Ride changed');
  });
});

describe('passenger pickup estimates', () => {
  it('excludes stale, off-shift, and other-company drivers', async () => {
    const driver = {company_id:'company-a',status:'available',current_lat:46,current_lng:-118,last_location_at:new Date().toISOString()};
    state.rows = {
      drivers: [
        {...driver,id:'fresh',default_vehicle_type:'ambulatory'},
        {...driver,id:'stale',default_vehicle_type:'wheelchair',last_location_at:'2000-01-01T00:00:00Z'},
        {...driver,id:'off-shift',default_vehicle_type:'stretcher'},
        {...driver,id:'other',company_id:'company-b',default_vehicle_type:'wheelchair'},
      ],
      driver_shifts: ['fresh','stale','other'].map(driver_id=>({driver_id,company_id:driver_id==='other'?'company-b':'company-a',clock_out_at:null})),
    };
    const result = await (getVehicleEtas as any)({data:{lat:46,lng:-118,company_slug:'walla'}});
    expect(result).toEqual({ambulatory:1});
  });
});
