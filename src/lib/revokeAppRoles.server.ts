import type { SupabaseClient } from '@supabase/supabase-js';

/** Revoke one workspace's permissions without deleting the shared identity or history. */
export async function revokeAppRoles(db: SupabaseClient, companyId: string, userId: string, roles: ('dispatch' | 'billing' | 'admin_biller')[]) {
  if (!companyId || !userId || !roles.length) throw new Error('Company, account and roles are required');
  const { data, error } = await db.from('user_roles').delete()
    .eq('company_id', companyId).eq('user_id', userId).in('role', roles).select('role');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('This account no longer has that app access in your company.');
}
