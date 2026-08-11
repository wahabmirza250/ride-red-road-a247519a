import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/diag-billing")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const mod = await import("@/lib/billing.functions");
          return new Response(JSON.stringify({ ok: true, keys: Object.keys(mod) }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          return new Response(
            JSON.stringify({ ok: false, message: String(e?.message ?? e), stack: String(e?.stack ?? "") }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
