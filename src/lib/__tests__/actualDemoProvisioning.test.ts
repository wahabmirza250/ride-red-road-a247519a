import { expect, it, vi } from 'vitest';
const state = vi.hoisted(()=>({profiles:[] as any[],owner:'11111111-1111-4111-8111-111111111111'}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{
 from:(table:string)=>{
  let payload:any;
  const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>q,single:()=>q,upsert:(p:any)=>{payload=p;if(table==='profiles')state.profiles.push(p);return q;},then:(resolve:any)=>Promise.resolve({error:null,data:table==='companies'?{id:'company',is_demo:true,demo_owner_id:state.owner}:table==='app_settings'?{value:'1'}:table==='profiles'?(payload?{id:payload.id}:null):[]}).then(resolve)};
  return q;
 },
 auth:{admin:{
  createUser:async(args:any)=>({data:{user:{id:args.email}},error:null}),
  getUserById:async()=>({data:{user:{app_metadata:{demo_owner_id:state.owner}}},error:null}),
  generateLink:async()=>({data:{properties:{hashed_token:'test-token'}},error:null}),
 }},
}}));
import { prepareActualDemo } from '@/lib/actualDemo.server';
it('creates company profiles explicitly when Auth has no profile-creation trigger',async()=>{
 const result=await prepareActualDemo(state.owner);
 expect(state.profiles).toHaveLength(2);
 for(const profile of state.profiles)expect(profile).toMatchObject({company_id:'company',is_active:true,sms_alerts_enabled:false});
 expect(result.slug).toBe('demo-1111111111114111');
 expect(result.token_hash).toBe('test-token');
});
