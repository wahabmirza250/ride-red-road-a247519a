import { createServerFn } from "@tanstack/react-start";

/** Return only the explicitly public, referrer-restricted browser key.
 * Generic server credentials must never be sent to the browser. */
export const getMapsBrowserKey = createServerFn({ method: "GET" }).handler(async () => ({
  key: process.env.GOOGLE_MAPS_BROWSER_KEY || null,
}));
