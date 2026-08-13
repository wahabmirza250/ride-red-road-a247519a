import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const Route = createFileRoute("/api/public/get-portal-credential")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) {
          return json({ error: "Missing X-API-Key header" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Validate API key against robot_api_keys
        const { data: keyRow, error: keyErr } = await supabaseAdmin
          .from("robot_api_keys" as any)
          .select("id")
          .eq("api_key", apiKey)
          .eq("is_active", true)
          .maybeSingle();
        if (keyErr) return json({ error: "Auth check failed" }, 500);
        if (!keyRow) return json({ error: "Invalid API key" }, 401);

        // Validate query params
        const url = new URL(request.url);
        const portal_id = url.searchParams.get("portal_id");
        const company_id = url.searchParams.get("company_id");

        if (!portal_id) {
          return json({ error: "portal_id query parameter is required" }, 400);
        }
        // FAIL CLOSED: a portal login belongs to exactly one company and is
        // NEVER shared, defaulted or borrowed. No company_id => no credential.
        if (!company_id) {
          return json(
            { error: "company_id query parameter is required: portal logins are never shared between companies" },
            400,
          );
        }
        if (!isUuid(company_id)) {
          return json({ error: "company_id must be a UUID" }, 400);
        }

        // Call service-role RPC to decrypt from vault (company-scoped, exact match)
        const { data, error } = await supabaseAdmin.rpc(
          "get_portal_credential_for_submission" as any,
          {
            _portal_id: portal_id,
            _company_id: company_id,
          },
        );



        if (error) {
          console.error("get-portal-credential rpc error", {
            message: error.message,
            code: (error as any).code,
            details: (error as any).details,
            hint: (error as any).hint,
          });
          return json({ error: "Credential lookup failed" }, 500);
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          return json(
            { error: "No portal credentials configured for this provider" },
            404,
          );
        }

        if (!row.login_password) {
          console.error("get-portal-credential vault decrypt returned empty password", {
            portal_id,
          });
          return json({ error: "Credential lookup failed" }, 500);
        }

        return json({
          portal_id: row.portal_id,
          portal_name: row.portal_name,
          state: row.state,
          login_email: row.login_email,
          login_password: row.login_password,
        });
      },
    },
  },
});
