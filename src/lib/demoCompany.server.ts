/** Server-owned demo flag; never trust a URL or browser-supplied demo flag. */
export async function isDemoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await (supabaseAdmin as any).from('companies').select('is_demo').eq('id', companyId).single();
  if (error) throw new Error('Could not verify company mode');
  return data.is_demo === true;
}
export async function assertRealCompany(companyId: string) {
  if (await isDemoCompany(companyId)) throw new Error('Demo company: external submissions and camera connections are disabled.');
}
export async function assertRealUser(userId: string) {
  const { requireCompanyId } = await import('./company.server');
  await assertRealCompany(await requireCompanyId(userId));
}
