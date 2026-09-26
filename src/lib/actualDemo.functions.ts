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
    const { data: profile, error: profileError } = await db.from('profiles').select('company_id').eq('id',context.userId).single();
    if (profileError || !profile?.company_id) throw new Error('Your company account is unavailable.');
    const { data: ownCompany, error: ownError } = await db.from('companies').select('is_demo,url_slug').eq('id',profile.company_id).single();
    if (ownError) throw new Error('Could not verify your company.');
    if (ownCompany.is_demo) return { slug: ownCompany.url_slug as string, token_hash: null as string | null };
    const { prepareActualDemo } = await import('./actualDemo.server');
    return prepareActualDemo(context.userId);
  });
