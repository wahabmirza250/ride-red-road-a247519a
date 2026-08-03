import { createServerFn } from "@tanstack/react-start";

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
      name: company.name,
      url_slug: company.url_slug,
      logo_url: company.logo_url,
      active: company.status === "active",
    };
  });
