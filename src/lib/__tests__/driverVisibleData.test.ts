import { describe, expect, it, vi } from 'vitest';
import { driverShiftView, DRIVER_REQUEST_FIELDS } from '../driverVisibleData';
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>{const chain:any={middleware:()=>chain,inputValidator:()=>chain,handler:(fn:any)=>fn};return chain;}}));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:{}}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>{
 let many=false,closed=false;
 const shift={id:'shift',clock_in_at:new Date(Date.now()-3600000).toISOString(),clock_out_at:null,gps_miles:12,hourly_rate_snapshot:987.65,earnings:1234.56};
 const q:any={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,single:()=>q,gte:()=>{many=true;return q;},update:()=>{closed=true;return q;},then:(resolve:any)=>Promise.resolve({error:null,data:table==='drivers'?{id:'driver'}:table==='driver_pay'?{hourly_rate:987.65,pay_type:'per_hour'}:many?[shift]:{...shift,clock_out_at:closed?new Date().toISOString():null}}).then(resolve)};return q;
}}}));
import { clockIn, clockOut, getCurrentShift, getShiftStats } from '../shifts.functions';
import { getMyPayroll } from '../myPayroll.functions';
import { listMyGasReceipts } from '../gasReceipts.functions';
const context={userId:'user'};
describe('driver financial visibility',()=>{
 it('only returns operational shift fields, including when new financial fields are added',()=>{
  expect(driverShiftView({id:'s',clock_in_at:'start',clock_out_at:null,gps_miles:12,earnings:123,bonus:500,hourly_rate_snapshot:50})).toEqual({id:'s',clock_in_at:'start',clock_out_at:null,start_odometer:undefined,end_odometer:undefined,gps_miles:12});
  expect(driverShiftView(null)).toBeNull();
 });
 it('never requests a fare or a wildcard in driver ride queries',()=>{
  expect(DRIVER_REQUEST_FIELDS).not.toMatch(/fare|amount|price|\*/);
  expect(DRIVER_REQUEST_FIELDS).toContain('pickup_address');
 });
 it.each([['clock in',clockIn],['clock out',clockOut],['current shift',getCurrentShift],['stats',getShiftStats]])('%s response excludes financial values',async(_name,fn)=>{
  const result=await (fn as any)({context,data:{}});
  expect(JSON.stringify(result)).not.toMatch(/earnings|hourly_rate|pay_type|987\.65|1234\.56/);
  expect(JSON.stringify(result)).toMatch(/clock_in_at|today_hours/);
 });
 it.each([['payroll',getMyPayroll],['receipts',listMyGasReceipts]])('blocks the old driver %s endpoint',async(_name,fn)=>{
  await expect((fn as any)({context,data:{}})).rejects.toThrow('managed by your company office');
 });
});
