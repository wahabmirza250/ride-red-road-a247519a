import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CompanyBranding = {
  name: string | null;
  slug: string | null;
  logo_url: string | null;
};

/**
 * Branding for the signed-in user's own company — the tenant logo shown next
 * to the RedArt mark in every staff app header. Logos live in a private
 * bucket, so we hand back a short-lived signed URL.
 */
export const getMyCompanyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyBranding> => {
    const { companyIdForUser } = await import("@/lib/company.server");
    const userId = (context as { userId: string }).userId;
    const companyId = await companyIdForUser(userId);
    if (!companyId) return { name: null, slug: null, logo_url: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, url_slug, logo_url")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) return { name: null, slug: null, logo_url: null };

    let logo: string | null = null;
    if (company.logo_url) {
      if (/^https?:\/\//i.test(company.logo_url)) {
        logo = company.logo_url;
      } else {
        const { data: signed } = await supabaseAdmin.storage
          .from("company-logos")
          .createSignedUrl(company.logo_url, 60 * 60);
        logo = signed?.signedUrl ?? null;
      }
    }

    return { name: company.name, slug: company.url_slug, logo_url: logo };
  });
