import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ roles: [] as {role:string}[], tables: [] as string[], error: null as any }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {const b:any={middleware:()=>b,handler:(fn:any)=>fn};return b;} }));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:{}}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>{
 state.tables.push(table);
 const q:any={select:()=>q,eq:()=>q,in:async()=>({data:state.roles,error:state.error}),single:async()=>({data:null,error:null})};return q;
}}}));
vi.mock('@/lib/actualDemo.server',()=>({prepareActualDemo:vi.fn(async(id:string)=>({slug:`demo-${id}`,token_hash:'test-token'}))}));
import { launchActualDemo } from '@/lib/actualDemo.functions';
import { prepareActualDemo } from '@/lib/actualDemo.server';
beforeEach(()=>{state.roles=[];state.tables=[];state.error=null;vi.clearAllMocks();});
const launch=()=> (launchActualDemo as any)({context:{userId:'owner'}});
it('allows a verified platform owner without a company profile',async()=>{
 state.roles=[{role:'platform_owner'}];
 expect(await launch()).toEqual({slug:'demo-owner',token_hash:'test-token'});
 expect(state.tables).toEqual(['user_roles']);
 expect(prepareActualDemo).toHaveBeenCalledWith('owner');
});
it('still requires company membership for company admins',async()=>{
 state.roles=[{role:'admin'}];
 await expect(launch()).rejects.toThrow('Your company account is unavailable');
 expect(prepareActualDemo).not.toHaveBeenCalled();
});
it('rejects users without an authorized role',async()=>{
 await expect(launch()).rejects.toThrow('Sign in');
 expect(prepareActualDemo).not.toHaveBeenCalled();
});
it('fails closed when role lookup fails',async()=>{
 state.roles=[{role:'platform_owner'}];state.error={message:'Unavailable'};
 await expect(launch()).rejects.toThrow('Sign in');
 expect(prepareActualDemo).not.toHaveBeenCalled();
});
