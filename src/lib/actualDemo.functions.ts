import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

/** Only an existing company admin can provision their own isolated presentation account. */
export const launchActualDemo = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db: any = supabaseAdmin;
    const { data: roles, error: roleError } = await db.from('user_roles').select('role').eq('user_id', context.userId).in('role',['admin','platform_owner']);
    if (roleError || !roles?.length) throw new Error('Sign in with your company admin account to open the full demo.');
    // Platform owners do not belong to a transport company. Provision their
    // own isolated demo directly after checking the server-held owner role.
    if (roles.some((role: {role: string}) => role.role === 'platform_owner')) {
      const { prepareActualDemo } = await import('./actualDemo.server');
      return prepareActualDemo(context.userId);
    }
    const { data: profile, error: profileError } = await db.from('profiles').select('company_id').eq('id',context.userId).single();
    if (profileError || !profile?.company_id) throw new Error('Your company account is unavailable.');
    const { data: ownCompany, error: ownError } = await db.from('companies').select('is_demo,url_slug').eq('id',profile.company_id).single();
    if (ownError) throw new Error('Could not verify your company.');
    if (ownCompany.is_demo) return { slug: ownCompany.url_slug as string, token_hash: null as string | null };
    const { prepareActualDemo } = await import('./actualDemo.server');
    return prepareActualDemo(context.userId);
  });

/** Keep stationary sample pins current during an active presentation. Never touches a real fleet. */
export const refreshActualDemoFleet = createServerFn({method:'POST'})
  .middleware([requireSupabaseAuth])
  .handler(async({context})=>{
    const { requireCompanyId } = await import('./company.server');
    const { isDemoCompany } = await import('./demoCompany.server');
    const companyId = await requireCompanyId(context.userId);
    if (!await isDemoCompany(companyId)) throw new Error('Demo company required.');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db:any=supabaseAdmin;
    const { presentationKey } = await import('./demoPresentation.server');
    const {data:seed,error:seedError}=await db.from('app_settings').select('value').eq('key',presentationKey(companyId)).maybeSingle();
    if(seedError)throw new Error('Could not check demo presentation data.');
    let upgraded=false;
    if(!seed) {
      const {data:company,error}=await db.from('companies').select('demo_owner_id,is_demo').eq('id',companyId).single();
      if(error || !company?.is_demo || !company.demo_owner_id)throw new Error('Demo ownership is unavailable.');
      const { prepareActualDemo }=await import('./actualDemo.server');
      await prepareActualDemo(company.demo_owner_id,{session:false});
      upgraded=true;
    }
    const { upgradeDemoStateReports } = await import('./demoStateReports.server');
    upgraded = await upgradeDemoStateReports(db, companyId) || upgraded;
    const {error} = await supabaseAdmin.from('drivers').update({last_location_at:new Date().toISOString()}).eq('company_id',companyId).neq('status','offline');
    if(error)throw new Error('Could not refresh demo locations.');
    return {ok:true,upgraded};
  });
