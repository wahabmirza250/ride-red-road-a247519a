import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const VehicleType = z.enum([
  "ground_ambulance",
  "wheelchair_van",
  "stretcher_van",
  "taxi",
  "ambulatory",
]);
const TripKind = z.enum(["one_way", "round_trip", "group_tour"]);

/* ---------- driver default vehicle ---------- */

export const saveDefaultVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicle_type: VehicleType,
        plate: z.string().min(1),
        vin: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("drivers")
      .update({
        default_vehicle_type: data.vehicle_type,
        default_plate: data.plate,
        default_vin: data.vin ?? null,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyDriverDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: driver, error: driverError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase
          .from("drivers")
          .select("id, default_vehicle_type, default_plate, default_vin")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", userId)
          .maybeSingle(),
      ]);
    if (driverError) throw new Error(driverError.message);
    if (profileError) throw new Error(profileError.message);
    const full_name = profile
      ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email || ""
      : "";
    return {
      id: driver?.id ?? null,
      default_vehicle_type: driver?.default_vehicle_type ?? null,
      default_plate: driver?.default_plate ?? null,
      default_vin: driver?.default_vin ?? null,
      driver_full_name: full_name,
    };
  });

export const getAssignedTripForNemt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (driverError) throw new Error(driverError.message);
    if (!driver) throw new Error("Driver profile not found");

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select(
        "id, passenger_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_time, status",
      )
      .eq("id", data.trip_id)
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (tripError) throw new Error(tripError.message);
    if (!trip) throw new Error("Assigned trip not found");

    const { data: passenger, error: passengerError } = await supabase
      .from("passengers")
      .select("id, first_name, last_name, phone, medicaid_id, date_of_birth, address")
      .eq("id", trip.passenger_id)
      .maybeSingle();
    if (passengerError) throw new Error(passengerError.message);

    let matchedRider = null;
    if (passenger?.medicaid_id) {
      const { data: riderByMedicaid, error } = await supabase
        .from("riders")
        .select("id, full_name, medicaid_id, dob, phone, address")
        .eq("medicaid_id", passenger.medicaid_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      matchedRider = riderByMedicaid;
    }

    if (!matchedRider && passenger) {
      const fullName = `${passenger.first_name} ${passenger.last_name}`.trim();
      const { data: riderByName, error } = await supabase
        .from("riders")
        .select("id, full_name, medicaid_id, dob, phone, address")
        .ilike("full_name", fullName)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      matchedRider = riderByName;
    }

    return {
      trip: {
        id: trip.id,
        pickup_address: trip.pickup_address,
        dropoff_address: trip.dropoff_address,
        scheduled_pickup_time: trip.scheduled_pickup_time,
        status: trip.status,
      },
      passenger: passenger
        ? {
            id: passenger.id,
            full_name: `${passenger.first_name} ${passenger.last_name}`.trim(),
            medicaid_id: passenger.medicaid_id,
            dob: passenger.date_of_birth,
            phone: passenger.phone,
            address: passenger.address,
          }
        : null,
      rider: matchedRider,
    };
  });

export const detectOdometerFromImage = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Odometer auto-detect is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  'Read the vehicle odometer number in this photo. Return only JSON like {"odometer":"123456","confidence":0.92}. If unreadable, return {"odometer":null,"confidence":0}. Do not include units, commas, decimals, or extra text.',
              },
              { type: "image_url", image_url: { url: data.image_data_url } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 80,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Odometer auto-detect failed (${response.status})${body ? `: ${body.slice(0, 180)}` : ""}`);
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content ?? "");
    const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    let parsed: { odometer?: unknown; confidence?: unknown } = {};
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = {};
    }

    const raw = typeof parsed.odometer === "string" || typeof parsed.odometer === "number"
      ? String(parsed.odometer)
      : "";
    const digits = raw.replace(/[^0-9]/g, "");
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (!digits || digits.length < 2) {
      return { odometer: null, confidence: 0, raw: content.slice(0, 160) };
    }

    return { odometer: digits, confidence: Math.max(0, Math.min(1, confidence)), raw: content.slice(0, 160) };
  });

/* ---------- create a trip group (one PDF per rider) ---------- */

const CreateSchema = z.object({
  trip_kind: TripKind,
  vehicle_type: VehicleType,
  vehicle_plate: z.string().min(1),
  vehicle_vin: z.string().nullable().optional(),
  escort_name: z.string().nullable().optional(),
  riders: z
    .array(
      z.object({
        rider_id: z.string().uuid(),
        identity_verified: z.boolean(),
        signed_by_escort: z.boolean().optional().default(false),
      }),
    )
    .min(1),
  legs: z
    .array(
      z.object({
        leg_index: z.union([z.literal(1), z.literal(2)]),
        leg_date: z.string(), // YYYY-MM-DD
        pickup_time: z.string().nullable().optional(), // HH:MM
        pickup_odometer: z.number().nonnegative(),
        pickup_address: z.string().min(1),
        dropoff_time: z.string().nullable().optional(),
        dropoff_odometer: z.number().nonnegative(),
        dropoff_address: z.string().min(1),
      }),
    )
    .min(1)
    .max(2),
});

export const createNemtTripGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const groupId = crypto.randomUUID();
    const now = new Date().toISOString();
    const leg1 = data.legs.find((l) => l.leg_index === 1)!;
    const leg2 = data.legs.find((l) => l.leg_index === 2) ?? null;

    // For each rider, create one medicaid_trips row (satisfies the "one PDF per rider" rule)
    const insertedIds: string[] = [];
    for (const r of data.riders) {
      // Use leg 1 addresses/odometer for the required legacy columns
      const totalStart = leg1.pickup_odometer;
      const totalEnd = leg2 ? leg2.dropoff_odometer : leg1.dropoff_odometer;
      const miles = Math.max(0, Number((totalEnd - totalStart).toFixed(1)));

      const pickupAt =
        `${leg1.leg_date}T${(leg1.pickup_time ?? "00:00")}:00`;

      const { data: inserted, error } = await supabase
        .from("medicaid_trips")
        .insert({
          driver_id: userId,
          rider_id: r.rider_id,
          pickup_at: pickupAt,
          pickup_address: leg1.pickup_address,
          dropoff_address: (leg2 ?? leg1).dropoff_address,
          odometer_start: totalStart,
          odometer_end: totalEnd,
          miles,
          status: "pending_review",
          trip_kind: data.trip_kind,
          vehicle_type: data.vehicle_type,
          vehicle_plate: data.vehicle_plate,
          vehicle_vin: data.vehicle_vin ?? null,
          escort_name: data.escort_name ?? null,
          identity_verified: r.identity_verified,
          signed_by_escort: r.signed_by_escort ?? false,
          group_id: groupId,
          created_at: now,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      insertedIds.push(inserted.id);

      // Insert legs for this trip row
      const legRows = data.legs.map((l) => ({
        medicaid_trip_id: inserted.id,
        leg_index: l.leg_index,
        leg_date: l.leg_date,
        pickup_time: l.pickup_time ?? null,
        pickup_odometer: l.pickup_odometer,
        pickup_address: l.pickup_address,
        dropoff_time: l.dropoff_time ?? null,
        dropoff_odometer: l.dropoff_odometer,
        dropoff_address: l.dropoff_address,
      }));
      const { error: legErr } = await supabase.from("medicaid_trip_legs").insert(legRows);
      if (legErr) throw new Error(legErr.message);
    }

    // Cache vehicle on driver profile for next time
    await supabase
      .from("drivers")
      .update({
        default_vehicle_type: data.vehicle_type,
        default_plate: data.vehicle_plate,
        default_vin: data.vehicle_vin ?? null,
      })
      .eq("user_id", userId);

    return { group_id: groupId, trip_ids: insertedIds };
  });

/* ---------- attach rider signature ---------- */

export const attachRiderSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        trip_id: z.string().uuid(),
        signature_path: z.string().min(1),
        signature_name: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("medicaid_trips")
      .update({
        signature_path: data.signature_path,
        signature_name: data.signature_name,
      })
      .eq("id", data.trip_id)
      .eq("driver_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- attach generated state PDF ---------- */

export const attachStatePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        trip_id: z.string().uuid(),
        state_pdf_path: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("medicaid_trips")
      .update({
        state_pdf_path: data.state_pdf_path,
        state_pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", data.trip_id)
      .eq("driver_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- signed URL for stored state PDF (admin or owning driver) ---------- */

export const getStatePdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: trip, error } = await supabase
      .from("medicaid_trips")
      .select("state_pdf_path")
      .eq("id", data.trip_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!trip?.state_pdf_path) return { url: null as string | null };
    const { data: signed, error: signErr } = await supabase.storage
      .from("state-pdfs")
      .createSignedUrl(trip.state_pdf_path, 60 * 15);
    if (signErr) throw new Error(signErr.message);
    return { url: signed?.signedUrl ?? null };
  });

/* ---------- load a group (for review / admin) ---------- */

export const getNemtGroup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ group_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: trips, error } = await supabase
      .from("medicaid_trips")
      .select("*, riders(*), medicaid_trip_legs(*)")
      .eq("group_id", data.group_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return trips ?? [];
  });
