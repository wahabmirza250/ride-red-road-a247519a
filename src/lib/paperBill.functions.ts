import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcClaim, type RateRow } from "@/lib/claimCalc";

/** Billing-workspace access check (admins + billing staff). */
async function assertBilling(supabase: any) {
  const { data, error } = await supabase.rpc("current_user_can_bill");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: billing staff only");
}

/* ------------------------------ riders ------------------------------ */

export const searchBillingRiders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().default("") }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertBilling(context.supabase);
    const term = data.q.trim();
    let query = context.supabase
      .from("riders")
      .select("id, full_name, medicaid_id, dob, phone")
      .order("full_name")
      .limit(20);
    if (term) {
      query = query.or(`full_name.ilike.%${term}%,medicaid_id.ilike.%${term}%`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* ------------------------------ rates ------------------------------ */

export const getBillingRatesForCalc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBilling(context.supabase);
    const { data, error } = await context.supabase
      .from("billing_rate_settings")
      .select(
        "vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
      );
    if (error) throw new Error(error.message);
    return (data ?? []) as RateRow[];
  });

/* ------------------------------ paper bill ------------------------------ */

const LegInput = z.object({
  pickup_odometer: z.number(),
  dropoff_odometer: z.number(),
});

const PaperBillInput = z.object({
  rider_id: z.string().uuid().nullable().optional(),
  new_rider: z
    .object({
      full_name: z.string().min(1),
      medicaid_id: z.string().min(1),
      dob: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  trip_date: z.string().min(8),
  vehicle_type: z.enum(["ambulatory", "wheelchair_van"]).default("ambulatory"),
  legs: z.array(LegInput).min(1).max(2),
  pickup_address: z.string().optional(),
  dropoff_address: z.string().optional(),
  /** Temp object already uploaded by the browser into the `state-pdfs` bucket. */
  upload_path: z.string().min(1),
  upload_mime: z.string().min(1),
});

/**
 * Create a `medicaid_trips` record from a paper trip report captured in the
 * billing chat. The uploaded photo/PDF becomes the trip's proof-of-service
 * document (`state_pdf_path`), so the trip then flows through the EXISTING
 * review → robot capture → confirm-submit pipeline untouched.
 */
export const createPaperBillTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PaperBillInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase);

    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);

    // 1. Resolve the rider
    let riderId = data.rider_id ?? null;
    if (!riderId) {
      if (!data.new_rider) throw new Error("Pick an existing passenger or add a new one");
      const { data: rider, error: riderErr } = await supabase
        .from("riders")
        .insert({
          full_name: data.new_rider.full_name.trim(),
          medicaid_id: data.new_rider.medicaid_id.trim(),
          dob: data.new_rider.dob || null,
          phone: data.new_rider.phone || null,
          company_id: companyId,
        })
        .select("id")
        .single();
      if (riderErr) throw new Error(riderErr.message);
      riderId = rider.id;
    }

    // 2. Odometers → miles → trip kind (purely from what was entered)
    const legs = data.legs.filter(
      (l) => Number.isFinite(l.pickup_odometer) && Number.isFinite(l.dropoff_odometer),
    );
    if (!legs.length) throw new Error("Leg 1 odometer readings are required");
    for (const [i, l] of legs.entries()) {
      if (l.dropoff_odometer <= l.pickup_odometer) {
        throw new Error(`Leg ${i + 1}: dropoff odometer must be greater than pickup odometer`);
      }
    }

    const { data: rateRows } = await supabase
      .from("billing_rate_settings")
      .select(
        "vehicle_type, unit_type, procedure_code, charge_amount, place_of_service, default_diagnosis_code",
      );
    const calc = calcClaim({
      legs,
      rates: (rateRows ?? []) as RateRow[],
      vehicleType: data.vehicle_type,
    });

    const pickupAt = new Date(`${data.trip_date.slice(0, 10)}T12:00:00Z`).toISOString();
    const pickupAddress = data.pickup_address?.trim() || "See attached paper trip report";
    const dropoffAddress = data.dropoff_address?.trim() || "See attached paper trip report";

    // 3. The trip itself — identical shape to a driver-app trip
    const { data: trip, error: tripErr } = await supabase
      .from("medicaid_trips")
      .insert({
        driver_id: userId,
        rider_id: riderId,
        company_id: companyId,
        pickup_at: pickupAt,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        odometer_start: legs[0].pickup_odometer,
        odometer_end: legs[legs.length - 1].dropoff_odometer,
        miles: calc.miles,
        trip_kind: calc.trip_kind,
        vehicle_type: data.vehicle_type,
        status: "pending_review",
      })
      .select("id")
      .single();
    if (tripErr) throw new Error(tripErr.message);

    // 4. Legs
    const legRows = legs.map((l, i) => ({
      medicaid_trip_id: trip.id,
      leg_index: i + 1,
      leg_date: data.trip_date.slice(0, 10),
      pickup_odometer: l.pickup_odometer,
      dropoff_odometer: l.dropoff_odometer,
      pickup_address: i === 0 ? pickupAddress : dropoffAddress,
      dropoff_address: i === 0 ? dropoffAddress : pickupAddress,
    }));
    const { error: legErr } = await supabase.from("medicaid_trip_legs").insert(legRows);
    if (legErr) throw new Error(legErr.message);

    // 5. Attach the paper report as the proof-of-service document
    const proofPath = await attachPaperProof({
      uploadPath: data.upload_path,
      mime: data.upload_mime,
      userId,
      tripId: trip.id,
    });
    await supabase
      .from("medicaid_trips")
      .update({
        state_pdf_path: proofPath,
        state_pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", trip.id);

    return {
      trip_id: trip.id,
      rider_id: riderId,
      trip_kind: calc.trip_kind,
      miles: calc.miles,
      total: calc.total,
      proof_path: proofPath,
    };
  });

/**
 * Normalize the uploaded paper report into a real PDF stored at the same
 * `state-pdfs` location the driver-app flow uses, so every downstream viewer
 * (billing tabs, detail sheet, robot attachment) keeps working unchanged.
 */
async function attachPaperProof(args: {
  uploadPath: string;
  mime: string;
  userId: string;
  tripId: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const finalPath = `${args.userId}/${args.tripId}.pdf`;

  const { data: file, error } = await supabaseAdmin.storage
    .from("state-pdfs")
    .download(args.uploadPath);
  if (error || !file) throw new Error(error?.message ?? "Could not read the uploaded document");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let pdfBytes: Uint8Array;
  if (args.mime === "application/pdf" || args.uploadPath.toLowerCase().endsWith(".pdf")) {
    pdfBytes = bytes;
  } else {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const img = args.mime.includes("png")
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    const maxW = 612;
    const maxH = 792;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const page = doc.addPage([maxW, maxH]);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (maxW - w) / 2, y: (maxH - h) / 2, width: w, height: h });
    pdfBytes = await doc.save();
  }

  const { error: upErr } = await supabaseAdmin.storage
    .from("state-pdfs")
    .upload(finalPath, new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), {
      upsert: true,
      contentType: "application/pdf",
    });
  if (upErr) throw new Error(upErr.message);

  if (args.uploadPath !== finalPath) {
    await supabaseAdmin.storage.from("state-pdfs").remove([args.uploadPath]);
  }
  return finalPath;
}

/* --------------------------- odometer OCR --------------------------- */

/**
 * Cheap, narrow OCR pass over a paper trip report: read only the four
 * odometer fields. Same fallback contract as the driver odometer photo —
 * anything unreadable or low-confidence comes back null so the biller
 * types it manually instead of trusting a guess.
 */
export const detectPaperBillOdometers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        image_data_url: z
          .string()
          .startsWith("data:image/")
          .max(9_000_000, "Image is too large. Use a smaller photo."),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBilling(context.supabase);
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Auto-read is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Cheapest vision-capable model: this is a 4-number read, not
        // document understanding.
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  'This is a NEMT paper trip report. Read ONLY the odometer readings. Return strict JSON: {"l1p":{"v":"123456","c":0.9},"l1d":{"v":null,"c":0},"l2p":{"v":null,"c":0},"l2d":{"v":null,"c":0}} where l1p/l1d are leg 1 (first trip) beginning/ending odometer and l2p/l2d are leg 2 (return trip) beginning/ending odometer. "v" is digits only (no commas, units or text) or null if you cannot read it clearly. "c" is your confidence 0-1. Never guess: if a field is blank, smudged, cropped, or ambiguous, use null with c 0. Output JSON only.',
              },
              { type: "image_url", image_url: { url: data.image_data_url } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Auto-read failed (${response.status})${body ? `: ${body.slice(0, 160)}` : ""}`,
      );
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content ?? "");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    } catch {
      parsed = {};
    }

    const MIN_CONFIDENCE = 0.6;
    const pick = (key: string): string | null => {
      const node = parsed[key] as { v?: unknown; c?: unknown } | undefined;
      if (!node || typeof node !== "object") return null;
      const conf = typeof node.c === "number" ? node.c : 0;
      const raw =
        typeof node.v === "string" || typeof node.v === "number" ? String(node.v) : "";
      const digits = raw.replace(/[^0-9]/g, "");
      if (conf < MIN_CONFIDENCE || digits.length < 2 || digits.length > 8) return null;
      return digits;
    };

    return {
      l1p: pick("l1p"),
      l1d: pick("l1d"),
      l2p: pick("l2p"),
      l2d: pick("l2d"),
    };
  });
