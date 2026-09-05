/**
 * WHICH PROVIDER OWNS THIS BILL?
 *
 * Billing is multi-company / multi-provider: the provider that owns the rate
 * rows and the portal configuration is a property of the COMPANY, never of
 * whichever admin happens to be looking at the screen. Every robot payload and
 * every rate lookup must use that provider.
 *
 * Fails closed: when the company has no unambiguous provider we return null so
 * the caller can raise a clear, actionable error instead of silently billing
 * under the signed-in admin's user id.
 */

export const PROVIDER_NOT_ASSIGNED_MESSAGE =
  "Billing provider is not assigned for this company — open Billing settings and choose the billing provider before submitting.";

export async function resolveCompanyIdForUser(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return (data as { company_id?: string } | null)?.company_id ?? null;
}

/**
 * The billing provider for a company.
 *  1. the explicitly configured default provider, else
 *  2. the single provider that owns this company's rate rows.
 * Ambiguous (several different providers, none chosen) resolves to null.
 */
export async function resolveBillingProviderId(
  supabase: { from: (t: string) => any },
  companyId: string | null,
): Promise<string | null> {
  if (!companyId) return null;

  const { data: settings } = await supabase
    .from("billing_settings")
    .select("default_provider_id")
    .eq("company_id", companyId)
    .maybeSingle();
  const chosen = (settings as { default_provider_id?: string } | null)?.default_provider_id;
  if (chosen) return chosen;

  const { data: rateRows } = await supabase
    .from("billing_rate_settings")
    .select("provider_id")
    .eq("company_id", companyId);
  const providers = Array.from(
    new Set(((rateRows ?? []) as { provider_id?: string }[]).map((r) => r.provider_id).filter(Boolean)),
  ) as string[];
  return providers.length === 1 ? providers[0]! : null;
}

/**
 * Provider for a specific bill: the trip's company decides, the caller's own
 * company is only used when the trip carries none.
 */
export async function resolveProviderForTrip(
  supabase: { from: (t: string) => any },
  args: { trip: any; userId: string },
): Promise<{ providerId: string | null; companyId: string | null }> {
  let companyId: string | null = args.trip?.company_id ?? null;
  if (!companyId && args.trip?.id) {
    const { data } = await supabase
      .from("medicaid_trips")
      .select("company_id")
      .eq("id", args.trip.id)
      .maybeSingle();
    companyId = (data as { company_id?: string } | null)?.company_id ?? null;
  }
  if (!companyId) companyId = await resolveCompanyIdForUser(supabase, args.userId);
  return { providerId: await resolveBillingProviderId(supabase, companyId), companyId };
}
