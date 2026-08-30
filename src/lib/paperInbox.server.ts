/** SERVER ONLY — shared guards for the durable paper inbox. */

/** Billing-workspace access check (admins + billing staff). */
export async function assertBillingAccess(supabase: any) {
  const { data, error } = await supabase.rpc("current_user_can_bill");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: billing staff only");
}
