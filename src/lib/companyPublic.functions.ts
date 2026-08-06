import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Public slug resolution for company entry links (`/{slug}/passenger`).
 * Returns only non-sensitive branding fields.
 */
export const resolveCompanySlug = createServerFn({ method: "POST" })
  .inputValidator((input: { slug: string }) => {
    const slug = String(input?.slug ?? "").trim().toLowerCase();
    if (!slug || slug.length > 60 || !/^[a-z0-9-]+$/.test(slug)) {
      throw new Error("Invalid company link");
    }
    return { slug };
  })
  .handler(async ({ data }) => {
    const { getCompanyBySlug } = await import("@/lib/company.server");
    const company = await getCompanyBySlug(data.slug);
    if (!company) return { found: false as const };
    return {
      found: true as const,
      id: company.id,
      name: company.name,
      url_slug: company.url_slug,
      logo_url: company.logo_url,
      active: company.status === "active",
    };
  });

/**
 * Authoritative company of the signed-in caller. This is what the URL slug is
 * checked against — a user can never view another company's slug-scoped app.
 */
export const getMyCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyIdForUser, getCompanyById } = await import("@/lib/company.server");
    const userId = (context as { userId: string }).userId;
    const id = await companyIdForUser(userId);
    if (!id) return { slug: null as string | null, name: null as string | null, active: false };
    const company = await getCompanyById(id);
    if (!company) return { slug: null as string | null, name: null as string | null, active: false };
    return {
      slug: company.url_slug,
      name: company.name,
      active: company.status === "active",
    };
  });
