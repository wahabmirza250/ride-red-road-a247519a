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

const VEHICLE_TYPES = new Set(["ambulatory", "wheelchair_van"]);
const UNIT_TYPES = new Set(["trip", "mile"]);

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const Route = createFileRoute("/api/public/get-billing-rate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) {
          return json({ error: "Missing X-API-Key header" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Validate API key
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
        const provider_id = url.searchParams.get("provider_id");
        const vehicle_type = url.searchParams.get("vehicle_type");
        const unit_type = url.searchParams.get("unit_type");

        if (!provider_id || !vehicle_type || !unit_type) {
          return json(
            { error: "provider_id, vehicle_type and unit_type query parameters are required" },
            400,
          );
        }
        if (!isUuid(provider_id)) {
          return json({ error: "provider_id must be a UUID" }, 400);
        }
        if (!VEHICLE_TYPES.has(vehicle_type)) {
          return json(
            { error: "vehicle_type must be 'ambulatory' or 'wheelchair_van'" },
            400,
          );
        }
        if (!UNIT_TYPES.has(unit_type)) {
          return json({ error: "unit_type must be 'trip' or 'mile'" }, 400);
        }

        // Rates are owned by the COMPANY, not by whichever staff member last
        // saved them. FAIL CLOSED: if we cannot resolve the company, or the
        // company has no configured rate, return an error the caller must
        // treat as fatal — never fall back to another row/default.
        const explicitCompany = url.searchParams.get("company_id");
        let companyId: string | null =
          explicitCompany && isUuid(explicitCompany) ? explicitCompany : null;
        if (!companyId) {
          const { data: prof } = await supabaseAdmin
            .from("profiles" as any)
            .select("company_id")
            .eq("id", provider_id)
            .maybeSingle();
          companyId = (prof as any)?.company_id ?? null;
        }
        if (!companyId) {
          return json(
            {
              error:
                "Billing rates not configured for this company - set them in Billing Settings first",
              code: "RATES_NOT_CONFIGURED",
              reason: "no_company_resolved",
            },
            409,
          );
        }

        const cols =
          "procedure_code, charge_amount, unit_type, place_of_service, default_diagnosis_code";
        const { data, error } = await supabaseAdmin
          .from("billing_rate_settings" as any)
          .select(cols)
          .eq("company_id", companyId)
          .eq("vehicle_type", vehicle_type)
          .eq("unit_type", unit_type)
          .maybeSingle();

        if (error) {
          console.error("get-billing-rate lookup error", { message: error.message, code: (error as any).code, details: (error as any).details, hint: (error as any).hint });
          return json({ error: "Lookup failed", detail: error.message, code: (error as any).code, hint: (error as any).hint }, 500);
        }
        if (!data) {
          return json(
            {
              error:
                "Billing rates not configured for this company - set them in Billing Settings first",
              code: "RATES_NOT_CONFIGURED",
              company_id: companyId,
              vehicle_type,
              unit_type,
            },
            409,
          );
        }


        return json({
          provider_id,
          vehicle_type,
          procedure_code: (data as any).procedure_code,
          charge_amount: Number((data as any).charge_amount),
          unit_type: (data as any).unit_type,
          place_of_service: (data as any).place_of_service,
          default_diagnosis_code: (data as any).default_diagnosis_code,
        });
      },
    },
  },
});
