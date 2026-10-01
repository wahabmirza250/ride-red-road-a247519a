import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({rows:{} as Record<string,any>,send:vi.fn(),filters:[] as any[]}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>{
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{m.filters.push([table,key,value]);return q;},maybeSingle:async()=>({data:m.rows[table],error:null})};return q;
}}}));
vi.mock('../pushSend.server',()=>({sendPushToUsers:m.send}));
import {deliverPassengerRidePush} from '../passengerRidePush.server';
const event={id:'event',company_id:'company',user_id:'rider',source_type:'trip' as const,source_id:'trip',status:'arrived_at_pickup',driver_id:'driver'};
beforeEach(()=>{
 vi.clearAllMocks();m.filters=[];
 m.rows={companies:{status:'active',url_slug:'walla'},profiles:{company_id:'company',is_active:true},user_roles:{role:'passenger'},trips:{status:'arrived_at_pickup',driver_id:'driver',passenger_id:'passenger'},passengers:{user_id:'rider'}};
 m.send.mockResolvedValue({sent:1,failed:0});
});
describe('passenger ride notification delivery',()=>{
 it('targets only the owning passenger with a private company route',async()=>{
  expect(await deliverPassengerRidePush(event)).toBe('sent');
  expect(m.send).toHaveBeenCalledWith(['rider'],expect.objectContaining({title:'Your driver has arrived',url:'/walla/passenger/track',rideStatus:'arrived_at_pickup'}));
  expect(m.filters).toContainEqual(['trips','company_id','company']);
 });
 it('drops an old arrival after cancellation',async()=>{m.rows.trips.status='cancelled';expect(await deliverPassengerRidePush(event)).toBe('obsolete');expect(m.send).not.toHaveBeenCalled();});
 it('drops an old arrival after reassignment',async()=>{m.rows.trips.driver_id='new-driver';expect(await deliverPassengerRidePush(event)).toBe('obsolete');expect(m.send).not.toHaveBeenCalled();});
 it('never sends after the account moves to another company',async()=>{m.rows.profiles.company_id='other';expect(await deliverPassengerRidePush(event)).toBe('obsolete');expect(m.send).not.toHaveBeenCalled();});
 it('rechecks passenger ownership before sending',async()=>{m.rows.passengers.user_id='other-rider';expect(await deliverPassengerRidePush(event)).toBe('obsolete');expect(m.send).not.toHaveBeenCalled();});
 it('leaves failed delivery eligible for retry',async()=>{m.send.mockResolvedValue({sent:0,failed:1});await expect(deliverPassengerRidePush(event)).rejects.toThrow('delivery failed');});
 it('does not mark missing tokens as successful delivery',async()=>{m.send.mockResolvedValue({sent:0,failed:0});await expect(deliverPassengerRidePush(event)).rejects.toThrow('no registered');});
});
