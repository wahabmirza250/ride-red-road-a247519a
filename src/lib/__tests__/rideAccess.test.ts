import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, company: 'a' }));
vi.mock('../company.server', () => ({ assertCompanyActive: vi.fn(async () => ({id:state.company})) }));
vi.mock('@/integrations/supabase/client.server', () => ({supabaseAdmin:{from:(table:string) => {
  let rows = state.tables[table] ?? [];
  const q:any = { select:()=>q, eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return q;},maybeSingle:async()=>({data:rows[0]??null}),then:(resolve:any)=>Promise.resolve({data:rows}).then(resolve) };
  return q;
}}}));
import { requireRideAccess } from '../rideAccess.server';
describe('privileged ride authorization', () => {
  beforeEach(()=> {state.company='a'; state.tables={ride_requests:[{id:'ride',company_id:'a',passenger_id:'p1',driver_id:'d1'}],user_roles:[],drivers:[{id:'d1',company_id:'a',user_id:'driver'}]};});
  it('allows only the owning passenger and rejects a forwarded identifier', async()=>{
    state.tables.user_roles=[{user_id:'p1',company_id:'a',role:'passenger'},{user_id:'p2',company_id:'a',role:'passenger'}];
    await expect(requireRideAccess('p1','ride')).resolves.toMatchObject({id:'ride'});
    await expect(requireRideAccess('p2','ride')).rejects.toThrow('unavailable');
    await expect(requireRideAccess('p1','ride',true)).rejects.toThrow('unavailable');
  });
  it('rejects a role assigned in a different company', async()=>{
    state.tables.user_roles=[{user_id:'admin',company_id:'b',role:'admin'}];
    await expect(requireRideAccess('admin','ride')).rejects.toThrow('unavailable');
  });
  it('rejects another company even when the caller is an administrator', async()=>{
    state.company='b';state.tables.user_roles=[{user_id:'admin',company_id:'b',role:'admin'}];
    await expect(requireRideAccess('admin','ride')).rejects.toThrow('unavailable');
  });
  it('allows assigned driver access but denies forced staff operations', async()=>{
    state.tables.user_roles=[{user_id:'driver',company_id:'a',role:'driver'}];
    await expect(requireRideAccess('driver','ride')).resolves.toMatchObject({id:'ride'});
    await expect(requireRideAccess('driver','ride',true)).rejects.toThrow('unavailable');
  });
});
