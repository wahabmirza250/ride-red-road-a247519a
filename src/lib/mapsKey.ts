import { getMapsBrowserKey } from "./mapsKey.functions";

let cached: Promise<string | null> | null = null;

/** True on Lovable-hosted preview/published domains. */
function isLovableHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovableproject.com") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
}

/**
 * Resolves the Google Maps JS browser key.
 *
 * On Lovable-hosted domains the managed connector key wins: it is
 * billing-enabled, so the map renders without the "For development purposes
 * only" watermark. On custom domains the managed key is referrer-blocked, so
 * the project-provided key is used instead.
 */
export function resolveMapsBrowserKey(): Promise<string | null> {
  if (cached) return cached;
  const managed = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;
  const custom = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  if (isLovableHost() && managed) {
    cached = Promise.resolve(managed);
    return cached;
  }

  cached = getMapsBrowserKey()
    .then((r) => r?.key || custom || managed || null)
    .catch(() => custom || managed || null);

  return cached;
}
