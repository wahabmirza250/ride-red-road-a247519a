import { getMapsBrowserKey } from "./mapsKey.functions";

let cached: Promise<string | null> | null = null;

/**
 * Resolves the Google Maps JS browser key.
 * Prefers the Lovable-managed connector browser key, then the server-held
 * GOOGLE_API_KEY secret, then build-time VITE_ vars.
 */
export function resolveMapsBrowserKey(): Promise<string | null> {
  if (cached) return cached;
  const managed = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;
  const custom = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  // A project-provided browser key must win on custom domains. The managed
  // key is intentionally restricted to Lovable-hosted domains.
  cached = getMapsBrowserKey()
    .then((r) => r?.key || custom || managed || null)
    .catch(() => custom || managed || null);

  return cached;
}
