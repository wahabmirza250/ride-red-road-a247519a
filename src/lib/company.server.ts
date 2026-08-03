/**
 * SERVER ONLY — tenant (company) resolution helpers.
 *
 * Tenant isolation is enforced in two layers:
 *   1. Postgres RESTRICTIVE RLS policies ("tenant_isolation") on every scoped
 *      table — these hold even for queries we forget to filter.
 *   2. Explicit company filters in privileged (service-role) code paths, which
 *      bypass RLS. Those paths MUST use the helpers below.
 */

export type CompanyRow = {
  id: string;
  name: string;
  url_slug: string;
  logo_url: string | null;
  status: string;
};

/** Company of a signed-in user, or null when the account has none. */
export async function companyIdForUser(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.company_id ?? null;
}

/** Company of a signed-in user; throws when missing. Use in privileged writes. */
export async function requireCompanyId(userId: string): Promise<string> {
  const id = await companyIdForUser(userId);
  if (!id) throw new Error("Your account is not linked to a company. Contact support.");
  return id;
}

export async function getCompanyById(id: string): Promise<CompanyRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, url_slug, logo_url, status")
    .eq("id", id)
    .maybeSingle();
  return (data as CompanyRow | null) ?? null;
}

export async function getCompanyBySlug(slug: string): Promise<CompanyRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, url_slug, logo_url, status")
    .eq("url_slug", slug.toLowerCase())
    .maybeSingle();
  return (data as CompanyRow | null) ?? null;
}

/** Throws when the user's company is suspended — used to block sign-in. */
export async function assertCompanyActive(userId: string): Promise<CompanyRow> {
  const id = await requireCompanyId(userId);
  const company = await getCompanyById(id);
  if (!company) throw new Error("Your company account no longer exists.");
  if (company.status !== "active") {
    throw new Error(
      `${company.name} is suspended. Please contact your administrator to restore access.`,
    );
  }
  return company;
}

export async function isPlatformOwner(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "platform_owner")
    .maybeSingle();
  return !!data;
}

export async function requirePlatformOwner(userId: string): Promise<void> {
  if (!(await isPlatformOwner(userId))) {
    throw new Error("Forbidden");
  }
}

/** URL-safe slug from a company name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
