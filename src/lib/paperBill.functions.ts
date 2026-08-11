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
  /** Driver name as written on the paper trip report (OCR or typed). */
  driver_name: z.string().trim().max(120).nullable().optional(),
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

    // 1. Resolve the rider — match an existing passenger on Medicaid ID first
    //    so re-billing a known member never trips the unique index.
    let riderId = data.rider_id ?? null;
    if (!riderId) {
      if (!data.new_rider) throw new Error("Pick an existing passenger or add a new one");
      const medicaidId = data.new_rider.medicaid_id.trim();
      const { data: existing } = await supabase
        .from("riders")
        .select("id")
        .eq("medicaid_id", medicaidId)
        .maybeSingle();
      if (existing?.id) {
        riderId = existing.id;
      } else {
        const { data: rider, error: riderErr } = await supabase
          .from("riders")
          .insert({
            full_name: data.new_rider.full_name.trim(),
            medicaid_id: medicaidId,
            dob: data.new_rider.dob || null,
            phone: data.new_rider.phone || null,
            company_id: companyId,
          })
          .select("id")
          .single();
        if (riderErr) {
          // Race or cross-company duplicate: fall back to the existing row.
          const { data: dupe } = await supabase
            .from("riders")
            .select("id")
            .eq("medicaid_id", medicaidId)
            .maybeSingle();
          if (!dupe?.id) throw new Error(riderErr.message);
          riderId = dupe.id;
        } else {
          riderId = rider.id;
        }
      }
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
        // Paper bills are already human-reviewed in the chat flow, so they go
        // straight to the submission queue instead of Pending review.
        status: "approved",
      })
      .select("id")
      .single();
    if (tripErr) throw new Error(tripErr.message);

    // 3b. Billing record. The DB trigger only auto-creates one for trips that
    // land in `pending_review`; paper bills skip straight to `approved`, so we
    // must create it here or the bill never shows up in the billing workflow
    // (and therefore never reaches the portal robot).
    const { error: brErr } = await supabase
      .from("billing_records")
      .upsert(
        {
          trip_id: trip.id,
          trip_form_id: trip.id,
          company_id: companyId,
          status: "approved",
        },
        { onConflict: "trip_id" },
      );
    if (brErr) throw new Error(brErr.message);


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

/* --------------------------- document OCR --------------------------- */

/**
 * One cheap vision pass over an uploaded paper trip report (image or PDF).
 * Reads the passenger, trip date, vehicle type and the four odometer
 * readings so the chat can calculate immediately. Same fallback contract as
 * the driver odometer photo: anything unreadable or low-confidence comes
 * back null so the biller fills it in instead of trusting a guess.
 */
export const detectPaperBillOdometers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        image_data_url: z
          .string()
          .startsWith("data:")
          .max(12_000_000, "File is too large. Use a smaller photo or PDF."),
        file_name: z.string().default("trip-report"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBilling(context.supabase);
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Auto-read is not configured");

    const isPdf = data.image_data_url.startsWith("data:application/pdf");
    const filePart = isPdf
      ? {
          type: "file",
          file: { filename: `${data.file_name}.pdf`, file_data: data.image_data_url },
        }
      : { type: "image_url", image_url: { url: data.image_data_url } };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Handwriting reading needs the full Flash model, not the lite tier.
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  'This is a HANDWRITTEN NEMT paper trip report (Colorado HCPF style). Read the handwriting carefully, field by field. Return strict JSON: {"name":{"v":null,"c":0},"medicaid_id":{"v":null,"c":0},"trip_date":{"v":null,"c":0},"vehicle_type":{"v":null,"c":0},"l1p":{"v":null,"c":0},"l1d":{"v":null,"c":0},"l2p":{"v":null,"c":0},"l2d":{"v":null,"c":0}}. name = member/passenger full name. medicaid_id = the Medicaid / Member / State ID, usually ONE letter followed by 6 digits (e.g. P458407, M964077); transcribe exactly, uppercase, no spaces or dashes; look near labels like "Medicaid ID", "Member ID", "State ID", "Client ID", "RID". trip_date = ISO YYYY-MM-DD. vehicle_type = "wheelchair_van" ONLY if the form explicitly says wheelchair van / WAV / marks a wheelchair box; if there is no such mention, or it is blank or unclear, return "ambulatory" (nearly all trips are ambulatory). l1p/l1d = leg 1 (outbound) beginning/ending odometer; l2p/l2d = leg 2 (return) beginning/ending odometer; digits only, no commas or units. Handwriting hints: 0 vs O, 1 vs 7, 4 vs 9, 5 vs S — in the ID field, a leading character is a letter and the rest are digits. "c" is your confidence 0-1. Never guess: if a field is blank, smudged, cropped or ambiguous use v null and c 0. Output JSON only.',
              },

              filePart,
            ],
          },
        ],
        temperature: 0,
        max_tokens: 400,
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
    const node = (key: string) => {
      const n = parsed[key] as { v?: unknown; c?: unknown } | undefined;
      if (!n || typeof n !== "object") return null;
      const conf = typeof n.c === "number" ? n.c : 0;
      if (conf < MIN_CONFIDENCE) return null;
      const raw = typeof n.v === "string" || typeof n.v === "number" ? String(n.v).trim() : "";
      return raw ? raw : null;
    };
    const odo = (key: string): string | null => {
      const raw = node(key);
      if (!raw) return null;
      const digits = raw.replace(/[^0-9]/g, "");
      if (digits.length < 2 || digits.length > 8) return null;
      return digits;
    };

    const rawDate = node("trip_date");
    const trip_date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    const rawVehicle = (node("vehicle_type") ?? "").toLowerCase();
    // Wheelchair van is only used when the form explicitly says so.
    // Anything else (blank, unreadable, unmarked) is ambulatory — 99% of trips.
    const vehicle_type = rawVehicle.includes("wheel") ? "wheelchair_van" : "ambulatory";


    const medicaidId = (node("medicaid_id") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

    // Link a known passenger straight away so billing reuses the existing
    // record instead of trying to create a duplicate member.
    let rider: { id: string; full_name: string; medicaid_id: string } | null = null;
    if (medicaidId) {
      const { data: match } = await context.supabase
        .from("riders")
        .select("id, full_name, medicaid_id")
        .eq("medicaid_id", medicaidId)
        .maybeSingle();
      if (match) rider = match as { id: string; full_name: string; medicaid_id: string };
    }

    return {
      name: node("name"),
      medicaid_id: medicaidId,
      rider,
      trip_date,
      vehicle_type,
      l1p: odo("l1p"),
      l1d: odo("l1d"),
      l2p: odo("l2p"),
      l2d: odo("l2d"),
    };
  });


