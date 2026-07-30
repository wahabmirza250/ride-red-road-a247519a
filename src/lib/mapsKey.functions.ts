import { createServerFn } from "@tanstack/react-start";

/**
 * Returns the browser-safe Google Maps JS API key.
 * Prefers the Lovable-managed connector browser key (billing-enabled and
 * referrer-restricted to the app's domains); falls back to the
 * project-provided GOOGLE_API_KEY secret.
 */
export const getMapsBrowserKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_API_KEY || null;
  return { key };
});
