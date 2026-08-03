/**
 * Client-side company (tenant) context.
 *
 * Company-specific entry links look like `/{company-slug}/passenger`. Those
 * links store the slug on the device and forward to the app route. The bare
 * app routes (`/passenger`, `/driver`, ...) then read the stored slug.
 *
 * IMPORTANT: for guests there is intentionally NO fallback company. A bare
 * URL with no stored context must never silently resolve to some company's
 * fleet or booking form — see `CompanyLinkRequired`.
 */
const KEY = "company_slug";

export function getCompanySlug(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  return v && v.trim() ? v.trim().toLowerCase() : null;
}

export function setCompanySlug(slug: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, slug.trim().toLowerCase());
}

export function clearCompanySlug() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
