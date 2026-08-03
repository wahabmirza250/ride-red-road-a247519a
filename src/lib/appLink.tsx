import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { getCompanySlug } from "@/lib/companyContext";

/**
 * Every in-app URL now lives under a company slug: `/walla/driver`,
 * `/walla/dashboard`, `/walla/passenger`, ...
 *
 * These are the first path segments that belong to the app shell (as opposed
 * to a company slug). They are used both for prefixing links and for detecting
 * legacy bare URLs like `/dashboard` so they can be redirected.
 */
export const APP_PREFIXES = new Set([
  "driver",
  "dispatch",
  "passenger",
  "dashboard",
  "live-ops",
  "planner",
  "trips",
  "medicaid-billing",
  "medicaid-trips",
  "schedules",
  "drivers",
  "payroll",
  "passengers",
  "reports",
  "incidents",
  "team",
  "events",
  "messages",
  "news-feed",
  "news",
  "games",
  "rewards-settings",
]);

export function firstSegment(path: string): string {
  return path.split("?")[0].split("#")[0].split("/")[1] ?? "";
}

export function isAppPath(path: string): boolean {
  return APP_PREFIXES.has(firstSegment(path));
}

/** Slug for the company currently being viewed (URL first, stored second). */
export function useCompanySlug(): string | null {
  const params = useParams({ strict: false }) as { companySlug?: string } | undefined;
  const fromUrl = params?.companySlug;
  if (fromUrl && !APP_PREFIXES.has(fromUrl)) return fromUrl;
  return getCompanySlug();
}

export function withSlug(slug: string | null, path: string): string {
  if (!slug || !path.startsWith("/") || !isAppPath(path)) return path;
  return `/${slug}${path}`;
}

type AnyProps = Record<string, unknown>;

/** `<Link>` that automatically prefixes app paths with the company slug. */
export function AppLink({ to, ...rest }: { to: string } & AnyProps) {
  const slug = useCompanySlug();
  const target = withSlug(slug, to);
  return <Link to={target as never} {...(rest as object)} />;
}

/** `useNavigate()` that automatically prefixes app paths with the company slug. */
export function useAppNavigate() {
  const navigate = useNavigate();
  const slug = useCompanySlug();
  return (opts: { to: string } & AnyProps) =>
    navigate({ ...opts, to: withSlug(slug, opts.to) } as never);
}
