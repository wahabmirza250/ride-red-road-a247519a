import { createServerFn } from "@tanstack/react-start";

/**
 * Returns the browser-safe Google Maps JS API key.
 * Prefers the project-provided GOOGLE_API_KEY secret, falling back to the
 * Lovable-managed connector browser key.
 */
export const getMapsBrowserKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY || null;
  return { key };
});
