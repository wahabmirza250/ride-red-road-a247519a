import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { supabase } from "@/lib/supabaseBrowser";


const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [
    // Exactly ONE auth client may own the stored session. The generated
    // attachSupabaseAuth uses a second GoTrue client on the same localStorage
    // key, which races refresh-token rotation (429s + revoked sessions), so it
    // is intentionally NOT registered. Do not re-add it.
    createMiddleware({ type: "function" }).client(async ({ next }) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      return next({
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }),
  ],
  requestMiddleware: [errorMiddleware],
}));
