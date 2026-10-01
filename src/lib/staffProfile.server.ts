/** Owner-authorized account creation must not depend on an optional signup trigger. */
export async function ensureStaffProfile(db: any, userId: string, data: {
  company_id: string; email: string; first_name?: string; last_name?: string;
}) {
  const { data: profile, error } = await db.from('profiles').upsert({
    id: userId, company_id: data.company_id, email: data.email,
    first_name: data.first_name ?? '', last_name: data.last_name ?? '',
  }, { onConflict: 'id' }).select('id,company_id').single();
  if (error || profile?.id !== userId || profile?.company_id !== data.company_id) {
    throw new Error('The account was created, but its company profile could not be saved. Repair the company profile before signing in.');
  }
}
