import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Twilio inbound-SMS webhook. Configure this URL as the "A MESSAGE COMES IN"
 * handler (HTTP POST) on the company's Twilio number.
 *
 * Flow: verify Twilio signature → resolve the company that owns the receiving
 * number → parse booking intent with one small AI call → create a real
 * ride_request that lands in that company's dispatch queue → reply via TwiML.
 */

function twiml(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

/** Twilio request signature: HMAC-SHA1 of full URL + sorted POST params. */
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null) {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!token) return false;
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Parsed = {
  pickup_address: string | null;
  dropoff_address: string | null;
  requested_pickup_time: string | null;
  passenger_name: string | null;
};

async function parseBooking(body: string): Promise<Parsed> {
  const key = process.env["LOVABLE_API_KEY"];
  const empty: Parsed = {
    pickup_address: null,
    dropoff_address: null,
    requested_pickup_time: null,
    passenger_name: null,
  };
  if (!key) return empty;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Extract ride booking details from a text message. Reply ONLY with compact JSON: " +
              '{"pickup_address":string|null,"dropoff_address":string|null,"requested_pickup_time":string|null,"passenger_name":string|null}. ' +
              `requested_pickup_time must be an ISO 8601 timestamp; today is ${new Date().toISOString()}. ` +
              "Use null for anything not clearly stated. Never invent an address.",
          },
          { role: "user", content: body.slice(0, 800) },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[sms-inbound] AI parse failed ${res.status}: ${await res.text()}`);
      return empty;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    const parsed = JSON.parse(match[0]) as Partial<Parsed>;
    const clean = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s && s.toLowerCase() !== "null" ? s : null;
    };
    return {
      pickup_address: clean(parsed.pickup_address),
      dropoff_address: clean(parsed.dropoff_address),
      requested_pickup_time:
        clean(parsed.requested_pickup_time) &&
        !Number.isNaN(Date.parse(String(parsed.requested_pickup_time)))
          ? new Date(String(parsed.requested_pickup_time)).toISOString()
          : null,
      passenger_name: clean(parsed.passenger_name),
    };
  } catch (e) {
    console.error("[sms-inbound] AI parse error", e);
    return empty;
  }
}

export const Route = createFileRoute("/api/public/sms-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(raw).entries()) params[k] = v;

        // Twilio signs the exact public URL it called.
        const url = request.url.split("?")[0]!;
        if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"))) {
          console.warn("[sms-inbound] rejected: bad Twilio signature");
          return new Response("Invalid signature", { status: 401 });
        }

        const from = params["From"] ?? "";
        const to = params["To"] ?? "";
        const body = (params["Body"] ?? "").trim();
        if (!from || !body) return twiml("Sorry, we couldn't read that message.");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Which tenant owns the number that received this text?
        const { data: company } = await supabaseAdmin
          .from("companies")
          .select("id, name, status")
          .eq("twilio_phone", to)
          .maybeSingle();
        if (!company) {
          console.warn(`[sms-inbound] no company owns ${to}`);
          return twiml("This number isn't set up for booking yet. Please call dispatch.");
        }
        if (company.status !== "active") {
          return twiml("Booking is temporarily unavailable. Please call dispatch.");
        }

        const parsed = await parseBooking(body);
        if (!parsed.pickup_address || !parsed.dropoff_address) {
          const missing = !parsed.pickup_address && !parsed.dropoff_address
            ? "your pickup address and destination"
            : !parsed.pickup_address
              ? "your pickup address"
              : "your destination";
          return twiml(
            `We need a bit more to book your ride. Please include ${missing} (example: "Pickup 123 Main St Denver, going to 456 Oak Ave at 2pm").`,
          );
        }

        // Reuse an existing passenger record for this phone when we have one.
        const { data: passenger } = await supabaseAdmin
          .from("passengers")
          .select("first_name, last_name, medicaid_id")
          .eq("company_id", company.id)
          .eq("phone", from)
          .maybeSingle();

        const contactName =
          parsed.passenger_name ??
          (passenger ? `${passenger.first_name ?? ""} ${passenger.last_name ?? ""}`.trim() : "") ??
          "";

        const { data: inserted, error } = await supabaseAdmin
          .from("ride_requests")
          .insert({
            company_id: company.id,
            passenger_id: null,
            pickup_address: parsed.pickup_address,
            dropoff_address: parsed.dropoff_address,
            requested_pickup_time: parsed.requested_pickup_time,
            contact_name: contactName || "SMS rider",
            contact_phone: from,
            contact_medicaid: passenger?.medicaid_id ?? null,
            notes: `Booked by SMS: "${body.slice(0, 300)}"`,
            status: "pending",
            source: "sms",
          })
          .select("id")
          .single();

        if (error || !inserted) {
          console.error("[sms-inbound] insert failed", error);
          return twiml("Sorry, something went wrong creating your ride. Please call dispatch.");
        }

        try {
          const { notifyDispatchers } = await import("@/lib/notifyStaff.server");
          await notifyDispatchers({
            kind: "ride_request",
            title: "New ride request (SMS)",
            body: `${contactName || from} — ${parsed.pickup_address} → ${parsed.dropoff_address}`,
            url: "/dispatch",
            companyId: company.id,
            data: { ride_request_id: inserted.id, phone: from, source: "sms" },
            smsSuffix: `Call back: ${from}`,
          });
        } catch (e) {
          console.warn("[sms-inbound] staff alert failed", e);
        }

        try {
          const { dispatchRideRequest } = await import("@/lib/dispatch.functions");
          await dispatchRideRequest({ data: { request_id: inserted.id } });
        } catch (e) {
          console.warn("[sms-inbound] auto-dispatch skipped", e);
        }

        return twiml(
          "Your ride has been requested — we'll text you when a driver is assigned.",
        );
      },
    },
  },
});
