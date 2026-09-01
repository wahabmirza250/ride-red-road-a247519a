/**
 * SERVER ONLY — company scoping for Super EDI.
 *
 * Normal billing staff always work inside their own company. A platform owner
 * may administer any onboarded company, but that cross-company access is
 * authorised HERE, server-side, through `is_platform_owner()` — never by
 * trusting a company id sent from the browser.
 */

/** Generated Supabase clients are heavily generic; the callers pass them as-is. */
type Sb = any;

export type EdiScope = {
  companyId: string;
  ownCompanyId: string | null;
  isPlatformOwner: boolean;
};

export async function isPlatformOwner(supabase: Sb): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_owner");
  if (error) return false;
  return data === true;
}

/**
 * Resolves the company every Super EDI query/write must be scoped to.
 * Throws when a non-owner asks for someone else's company.
 */
export async function resolveEdiScope(
  supabase: Sb,
  userId: string,
  requestedCompanyId?: string | null,
): Promise<EdiScope> {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);

  const { companyIdForUser } = await import("@/lib/company.server");
  const own = await companyIdForUser(userId);
  const owner = await isPlatformOwner(supabase);

  const requested = requestedCompanyId?.trim() || null;
  if (!requested || requested === own) {
    if (!own) throw new Error("Your account is not linked to a company. Contact support.");
    return { companyId: own, ownCompanyId: own, isPlatformOwner: owner };
  }

  if (!owner) throw new Error("Forbidden: you can only manage your own company's EDI setup");
  return { companyId: requested, ownCompanyId: own, isPlatformOwner: true };
}

export type EdiCompanyOption = { id: string; name: string; url_slug: string; status: string };

/** Companies the caller may administer: every active company for an owner, else their own. */
export async function listScopedCompanies(
  supabase: Sb,
  userId: string,
): Promise<{ companies: EdiCompanyOption[]; isPlatformOwner: boolean; ownCompanyId: string | null }> {
  const { assertBilling } = await import("@/lib/billingHelpers");
  await assertBilling(supabase, userId);

  const { companyIdForUser, getCompanyById } = await import("@/lib/company.server");
  const own = await companyIdForUser(userId);
  const owner = await isPlatformOwner(supabase);

  if (!owner) {
    if (!own) return { companies: [], isPlatformOwner: false, ownCompanyId: null };
    const company = await getCompanyById(own);
    return {
      companies: company
        ? [{ id: company.id, name: company.name, url_slug: company.url_slug, status: company.status }]
        : [],
      isPlatformOwner: false,
      ownCompanyId: own,
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, url_slug, status")
    .order("name", { ascending: true });
  return {
    companies: (data ?? []) as EdiCompanyOption[],
    isPlatformOwner: true,
    ownCompanyId: own,
  };
}
