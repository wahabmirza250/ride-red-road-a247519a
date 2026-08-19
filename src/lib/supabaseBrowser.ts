import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function getPublicConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Backend is not connected. Please connect Lovable Cloud.");
  }
  return { url, key };
}

function createBrowserClient() {
  const { url, key } = getPublicConfig();
  return createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    auth: {
      // Isolate the canonical app session from legacy/generated clients that
      // used the backend SDK's default key. Old cached tabs can otherwise
      // keep rotating the same refresh token after a new build is published.
      storageKey: "redart-auth-v2",
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      // Do not let GoTrue's background timer rotate a freshly-issued token.
      // On devices whose clock is ahead, the timer can consider the new token
      // expired immediately and start concurrent refreshes across open tabs,
      // revoking the session and rate-limiting the account. Authenticated API
      // calls still refresh on demand through getSession() when necessary.
      autoRefreshToken: false,
    },
  });
}

let browserSupabase: ReturnType<typeof createBrowserClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_, prop, receiver) {
    if (!browserSupabase) browserSupabase = createBrowserClient();
    return Reflect.get(browserSupabase, prop, receiver);
  },
});
