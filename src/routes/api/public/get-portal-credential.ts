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
        // Tolerate stray whitespace/newlines or a "Bearer "/quote wrapper that
        // often sneaks in when the key is pasted into a hosting dashboard.
        const apiKey = (request.headers.get("x-api-key") ?? "")
          .trim()
          .replace(/^Bearer\s+/i, "")
          .replace(/^["']|["']$/g, "");
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
        // Normalize the portal id the same way it is stored on save: stray
        // whitespace/newlines or casing from a hosting env var must not turn a
        // configured credential into a 404.
        const portal_id = (url.searchParams.get("portal_id") ?? "")
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase();
        const company_id = (url.searchParams.get("company_id") ?? "")
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase();

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

        const row: any = Array.isArray(data) ? data[0] : data;
        if (!row) {
          // Fail closed, but say WHICH company/portal missed and which portal
          // ids that company does have configured. Never leaks another
          // company's data: the list is scoped to the requested company_id.
          const { data: configured } = await supabaseAdmin
            .from("state_portal_credentials" as any)
            .select("portal_id")
            .eq("company_id", company_id);
          const available = (configured ?? []).map((r: any) => r.portal_id);
          return json(
            {
              error:
                "No portal login configured for this company — add one in Team & apps first",
              code: "NO_PORTAL_CREDENTIAL",
              requested_portal_id: portal_id,
              requested_company_id: company_id,
              configured_portal_ids: available,
            },
            404,
          );
        }

        if (!row.login_password) {
          console.error("get-portal-credential vault decrypt returned empty password", {
            portal_id,
          });
          return json({ error: "Credential lookup failed" }, 500);
        }

        // Integrity gate: the decrypted secret must be byte-identical to the
        // one that was saved (compared through a one-way fingerprint — the
        // password itself is never logged, hashed client-side, or returned in
        // diagnostics). A mismatch means a stale/rotated secret pointer, so we
        // refuse rather than hand the robot a password HCPF will reject.
        if (row.fingerprint_matches === false) {
          console.error("get-portal-credential fingerprint mismatch", {
            portal_id,
            company_id,
            stored_fingerprint: row.stored_fingerprint,
            live_fingerprint: row.password_fingerprint,
            password_len: row.password_len,
          });
          return json(
            {
              error:
                "Saved portal login failed its integrity check — re-save the password in Billing settings",
              code: "CREDENTIAL_FINGERPRINT_MISMATCH",
            },
            409,
          );
        }

        // Whitespace never reaches the portal form.
        const login_email = String(row.login_email ?? "").trim();
        const login_password = String(row.login_password).replace(/^[\s]+|[\s]+$/g, "");

        // Fingerprint-only mode: proves which secret is being served without
        // ever transmitting the password.
        if (url.searchParams.get("verify") === "1") {
          return json({
            portal_id: row.portal_id,
            login_email,
            password_len: login_password.length,
            password_fingerprint: row.password_fingerprint,
            stored_fingerprint: row.stored_fingerprint,
            fingerprint_matches: row.fingerprint_matches !== false,
            password_updated_at: row.password_updated_at,
          });
        }

        return json({
          portal_id: row.portal_id,
          portal_name: row.portal_name,
          state: row.state,
          login_email,
          login_password,
          // one-way, safe to log on the robot side
          password_len: login_password.length,
          password_fingerprint: row.password_fingerprint,
          password_updated_at: row.password_updated_at,
        });
      },
    },
  },
});
