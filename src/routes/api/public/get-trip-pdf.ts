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

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const PDF_BUCKET = "state-pdfs";

export const Route = createFileRoute("/api/public/get-trip-pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) {
          return json({ error: "Missing X-API-Key header" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Validate API key (same pattern as get-billing-rate)
        const { data: keyRow, error: keyErr } = await supabaseAdmin
          .from("robot_api_keys" as any)
          .select("id")
          .eq("api_key", apiKey)
          .eq("is_active", true)
          .maybeSingle();
        if (keyErr) return json({ error: "Auth check failed" }, 500);
        if (!keyRow) return json({ error: "Invalid API key" }, 401);

        const url = new URL(request.url);
        const trip_id = url.searchParams.get("trip_id");

        if (!trip_id) {
          return json({ error: "trip_id query parameter is required" }, 400);
        }
        if (!isUuid(trip_id)) {
          return json({ error: "trip_id must be a UUID" }, 400);
        }

        const { data: trip, error: tripErr } = await supabaseAdmin
          .from("medicaid_trips")
          .select("id, state_pdf_path")
          .eq("id", trip_id)
          .maybeSingle();

        if (tripErr) {
          console.error("get-trip-pdf trip lookup error", {
            message: tripErr.message,
            code: (tripErr as any).code,
            details: (tripErr as any).details,
            hint: (tripErr as any).hint,
          });
          return json({ error: "Lookup failed", detail: tripErr.message }, 500);
        }
        if (!trip) {
          return json({ error: "Trip not found" }, 404);
        }

        const pdfPath = (trip as any).state_pdf_path as string | null;
        if (!pdfPath || pdfPath.trim() === "") {
          return json({ error: "No PDF generated yet for this trip" }, 404);
        }

        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(PDF_BUCKET)
          .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);

        if (signErr || !signed?.signedUrl) {
          console.error("get-trip-pdf sign url error", { message: signErr?.message, path: pdfPath });
          return json(
            { error: "Failed to generate signed URL", detail: signErr?.message ?? "unknown" },
            500,
          );
        }

        return json({
          trip_id,
          pdf_url: signed.signedUrl,
          generated_at: new Date().toISOString(),
        });
      },
    },
  },
});
