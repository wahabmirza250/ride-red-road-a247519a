import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ userId: null as string | null, insert: null as any }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => { const b:any={middleware:()=>b,inputValidator:()=>b,handler:(fn:any)=>fn};return b;} }));
vi.mock("@/integrations/supabase/auth-middleware",()=>({requireSupabaseAuth:{}}));
vi.mock("@/lib/staffGuard.server",()=>({requireStaff:async()=>({isAdmin:true}),logDispatchEvent:async()=>{}}));
vi.mock("@/integrations/supabase/client.server",()=>({supabaseAdmin:{from:(table:string)=>{
  const q:any={ select:()=>q,eq:()=>q,insert:(data:any)=>{state.insert=data;return q;},
    maybeSingle:async()=>({data:table==="profiles"?{company_id:"company"}:{id:"passenger-record",user_id:state.userId,first_name:"Sample",medicaid_id:"DEMO004"},error:null}),
    single:async()=>({data:{id:"request",status:"pending",driver_id:null},error:null}) };return q;
}}}));
import { dispatchScheduleRide } from "@/lib/dispatchSchedule.functions";
const schedule=()=> (dispatchScheduleRide as any)({data:{passenger_id:"passenger-record",pickup_address:"Pickup",dropoff_address:"Dropoff",scheduled_pickup_time:"2026-09-27T12:00:00Z"},context:{userId:"staff"}});
describe("dispatch request passenger identity",()=>{
  beforeEach(()=>{state.userId=null;state.insert=null;});
  it("schedules staff-created passengers without using their record ID as an auth ID",async()=>{await schedule();expect(state.insert.passenger_id).toBeNull();expect(state.insert.contact_medicaid).toBe("DEMO004");expect(state.insert.company_id).toBe("company");});
  it("uses the linked account for passengers with a login",async()=>{state.userId="passenger-login";await schedule();expect(state.insert.passenger_id).toBe("passenger-login");});
});
