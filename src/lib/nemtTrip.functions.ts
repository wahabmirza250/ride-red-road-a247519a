import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateStateFormPdf, type Leg } from "@/lib/medicaidPdf";

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

/* ---------- finalize a dispatch trip into a medicaid_trips row + PDF payload ---------- */

const FinalizeSchema = z.object({
  trip_id: z.string().uuid(),
  odometer_start: z.number().nonnegative(),
  odometer_end: z.number().nonnegative(),
  signature_path: z.string().min(1),
  signer_name: z.string().min(1),
  signed_by_escort: z.boolean().optional().default(false),
});

export const finalizeMedicaidFromDispatchTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FinalizeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Driver row (for vehicle info + id)
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .select("id, default_vehicle_type, default_plate, default_vin, vehicle_plate")
      .eq("user_id", userId)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!driver) throw new Error("Driver profile not found");

    // Trip (verify driver owns it)
    const { data: trip, error: tErr } = await supabase
      .from("trips")
      .select(
        "id, passenger_id, pickup_address, dropoff_address, actual_pickup_time, actual_dropoff_time, scheduled_pickup_time",
      )
      .eq("id", data.trip_id)
      .eq("driver_id", driver.id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!trip) throw new Error("Trip not found for this driver");

    // Passenger
    const { data: passenger, error: pErr } = await supabase
      .from("passengers")
      .select("id, first_name, last_name, phone, medicaid_id, date_of_birth, address")
      .eq("id", trip.passenger_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!passenger) throw new Error("Passenger not found");

    const fullName = `${passenger.first_name ?? ""} ${passenger.last_name ?? ""}`.trim() || "Passenger";

    // Find or create rider
    let riderId: string | null = null;
    if (passenger.medicaid_id) {
      const { data: existing } = await supabase
        .from("riders")
        .select("id")
        .eq("medicaid_id", passenger.medicaid_id)
        .maybeSingle();
      if (existing) riderId = existing.id;
    }
    if (!riderId) {
      const { data: created, error: rErr } = await supabase
        .from("riders")
        .insert({
          full_name: fullName,
          medicaid_id: passenger.medicaid_id ?? `SELF-${passenger.id.slice(0, 8)}`,
          dob: passenger.date_of_birth ?? null,
          phone: passenger.phone ?? null,
          address: passenger.address ?? null,
        })
        .select("id")
        .single();
      if (rErr) throw new Error(rErr.message);
      riderId = created.id;
      // Copy SSN from passenger vault secret if present
      try {
        await supabase.rpc("copy_passenger_ssn_to_rider", {
          _passenger_id: passenger.id,
          _rider_id: riderId,
        });
      } catch {
        /* non-fatal */
      }
    }

    // Driver profile name
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", userId)
      .maybeSingle();
    const driverName =
      `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || profile?.email || "";

    // Persist odometer_end on the trip if missing
    await supabase
      .from("trips")
      .update({ odometer_end: data.odometer_end })
      .eq("id", trip.id);

    const pickupIso = trip.actual_pickup_time ?? trip.scheduled_pickup_time ?? new Date().toISOString();
    const dropoffIso = trip.actual_dropoff_time ?? new Date().toISOString();
    const legDate = pickupIso.slice(0, 10);
    const pickupHm = pickupIso.slice(11, 16);
    const dropoffHm = dropoffIso.slice(11, 16);
    const miles = Math.max(0, Number((data.odometer_end - data.odometer_start).toFixed(1)));

    const plate = driver.default_plate ?? driver.vehicle_plate ?? "";
    const vin = driver.default_vin ?? null;
    const vehicleType = driver.default_vehicle_type ?? null;

    // Check for an existing medicaid_trips row for this dispatch trip to avoid duplicates.
    // Prefer the direct dispatch_trip_id link; keep the legacy match as a fallback for
    // rows created before that link existed.
    const { data: existingLinkedMt } = await supabase
      .from("medicaid_trips")
      .select("id")
      .eq("dispatch_trip_id", trip.id)
      .maybeSingle();

    const { data: existingLegacyMt } = existingLinkedMt
      ? { data: null }
      : await supabase
      .from("medicaid_trips")
      .select("id")
      .eq("driver_id", userId)
      .eq("rider_id", riderId)
      .eq("pickup_at", pickupIso)
      .maybeSingle();

    let medicaidTripId: string;
    const existingMt = existingLinkedMt ?? existingLegacyMt;
    if (existingMt) {
      medicaidTripId = existingMt.id;
      const { error: updateMtErr } = await supabase
        .from("medicaid_trips")
        .update({
          dispatch_trip_id: trip.id,
          pickup_address: trip.pickup_address,
          dropoff_address: trip.dropoff_address,
          odometer_start: data.odometer_start,
          odometer_end: data.odometer_end,
          miles,
          vehicle_type: vehicleType,
          vehicle_plate: plate,
          vehicle_vin: vin,
          signature_path: data.signature_path,
          signature_name: data.signer_name,
          signed_by_escort: data.signed_by_escort,
        } as any)
        .eq("id", medicaidTripId);
      if (updateMtErr) throw new Error(updateMtErr.message);
    } else {
      const { data: inserted, error: mtErr } = await supabase
        .from("medicaid_trips")
        .insert({
          dispatch_trip_id: trip.id,
          driver_id: userId,
          rider_id: riderId,
          pickup_at: pickupIso,
          pickup_address: trip.pickup_address,
          dropoff_address: trip.dropoff_address,
          odometer_start: data.odometer_start,
          odometer_end: data.odometer_end,
          miles,
          status: "pending_review",
          trip_kind: "one_way",
          vehicle_type: vehicleType,
          vehicle_plate: plate,
          vehicle_vin: vin,
          signature_path: data.signature_path,
          signature_name: data.signer_name,
          signed_by_escort: data.signed_by_escort,
        })
        .select("id")
        .single();
      if (mtErr) throw new Error(mtErr.message);
      medicaidTripId = inserted.id;

      await supabase.from("medicaid_trip_legs").insert({
        medicaid_trip_id: medicaidTripId,
        leg_index: 1,
        leg_date: legDate,
        pickup_time: pickupHm,
        pickup_odometer: data.odometer_start,
        pickup_address: trip.pickup_address,
        dropoff_time: dropoffHm,
        dropoff_odometer: data.odometer_end,
        dropoff_address: trip.dropoff_address,
      });
    }

    // Resolve the ID field for the PDF (prefer full SSN when medicaid_id is a SELF- placeholder)
    let riderIdentifier = passenger.medicaid_id ?? "";
    if (!riderIdentifier || riderIdentifier.startsWith("SELF-")) {
      try {
        const { data: ssn } = await supabase.rpc("get_decrypted_passenger_ssn", {
          _passenger_id: passenger.id,
        });
        if (ssn) riderIdentifier = String(ssn);
      } catch {
        /* fall through */
      }
    }

    return {
      medicaid_trip_id: medicaidTripId,
      pdf: {
        rider: {
          full_name: fullName,
          medicaid_id: riderIdentifier,
          dob: passenger.date_of_birth,
          phone: passenger.phone,
          address: passenger.address,
        },
        driverName,
        vehiclePlate: plate,
        vehicleVin: vin,
        vehicleType,
        tripKind: "one_way" as const,
        legs: [
          {
            leg_index: 1 as const,
            leg_date: legDate,
            pickup_time: pickupHm,
            pickup_odometer: data.odometer_start,
            pickup_address: trip.pickup_address,
            dropoff_time: dropoffHm,
            dropoff_odometer: data.odometer_end,
            dropoff_address: trip.dropoff_address,
          },
        ],
        signatureName: data.signer_name,
        signedByEscort: data.signed_by_escort,
      },
    };
  });

const EnsureDispatchPdfSchema = z.object({ trip_id: z.string().uuid() });

export const ensureDispatchTripStatePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnsureDispatchPdfSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select("id, driver_id")
      .eq("id", data.trip_id)
      .maybeSingle();
    if (tripErr) throw new Error(tripErr.message);
    if (!trip) throw new Error("Trip not found");
    if (!trip.driver_id) throw new Error("Trip is missing an assigned driver");

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);

    const { data: driver, error: driverErr } = await supabase
      .from("drivers")
      .select("id, user_id")
      .eq("id", trip.driver_id)
      .maybeSingle();
    if (driverErr) throw new Error(driverErr.message);
    if (!driver) throw new Error("Driver not found");
    if (!isAdmin && driver.user_id !== userId) throw new Error("Forbidden");

    const { data: mt, error: mtErr } = await supabase
      .from("medicaid_trips")
      .select("*, riders(id, full_name, medicaid_id, dob, phone, address, last_4_ssn), medicaid_trip_legs(*)")
      .eq("dispatch_trip_id", trip.id)
      .maybeSingle();
    if (mtErr) throw new Error(mtErr.message);
    if (!mt) throw new Error("No HCPF trip report was created for this ride yet");

    if (mt.state_pdf_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(mt.state_pdf_path, 60 * 15);
      if (signErr) throw new Error(signErr.message);
      return {
        ok: true,
        generated: false,
        medicaid_trip_id: mt.id,
        state_pdf_path: mt.state_pdf_path,
        url: signed?.signedUrl ?? null,
      };
    }

    if (!mt.signature_path) {
      throw new Error("No saved passenger signature found for this trip");
    }

    const { data: sig, error: sigErr } = await supabase.storage
      .from("signatures")
      .createSignedUrl(mt.signature_path, 60 * 15);
    if (sigErr) throw new Error(sigErr.message);
    if (!sig?.signedUrl) throw new Error("Could not load saved passenger signature");

    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", mt.driver_id)
      .maybeSingle();
    const driverName = profile
      ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email || ""
      : "";

    let riderForPdf = mt.riders ?? null;
    if (riderForPdf?.id) {
      const raw = String(riderForPdf.medicaid_id ?? "").trim();
      const needsSsn = !raw || raw.startsWith("SSN-") || raw.startsWith("WALK-") || raw.startsWith("SELF-");
      if (needsSsn) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ssn } = await supabaseAdmin.rpc("get_decrypted_rider_ssn", {
            _rider_id: riderForPdf.id,
          });
          if (ssn && typeof ssn === "string") riderForPdf = { ...riderForPdf, medicaid_id: ssn };
        } catch {
          /* fall back to the rider row value */
        }
      }
    }

    const legs = normalizeMedicaidTripLegs(mt);
    const pdfBytes = await generateStateFormPdf(
      {
        rider: riderForPdf,
        driverName,
        vehiclePlate: mt.vehicle_plate ?? null,
        vehicleVin: mt.vehicle_vin ?? null,
        vehicleType: mt.vehicle_type ?? null,
        escortName: mt.escort_name ?? null,
        identityVerified: mt.identity_verified !== false,
        tripKind: mt.trip_kind ?? "one_way",
        legs,
        signatureName: mt.signature_name ?? riderForPdf?.full_name ?? null,
        signatureUrl: sig.signedUrl,
        signedByEscort: mt.signed_by_escort ?? false,
      },
      { templateBaseUrl: getRequestOrigin() },
    );

    const pdfPath = `${mt.driver_id}/${mt.id}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("state-pdfs")
      .upload(pdfPath, new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), {
        upsert: true,
        contentType: "application/pdf",
      });
    if (uploadErr) throw new Error(uploadErr.message);

    const { error: updateErr } = await supabase
      .from("medicaid_trips")
      .update({
        state_pdf_path: pdfPath,
        state_pdf_generated_at: new Date().toISOString(),
      } as any)
      .eq("id", mt.id);
    if (updateErr) throw new Error(updateErr.message);

    const { data: signed, error: signErr } = await supabase.storage
      .from("state-pdfs")
      .createSignedUrl(pdfPath, 60 * 15);
    if (signErr) throw new Error(signErr.message);

    return {
      ok: true,
      generated: true,
      medicaid_trip_id: mt.id,
      state_pdf_path: pdfPath,
      url: signed?.signedUrl ?? null,
    };
  });

function getRequestOrigin(): string {
  const origin = getRequestHeader("origin");
  if (origin) return origin;
  const host = getRequestHeader("x-forwarded-host") ?? getRequestHeader("host");
  const proto = getRequestHeader("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:8080";
}

function normalizeMedicaidTripLegs(trip: any): Leg[] {
  const rows = Array.isArray(trip.medicaid_trip_legs)
    ? [...trip.medicaid_trip_legs].sort((a, b) => Number(a.leg_index) - Number(b.leg_index))
    : [];

  if (rows.length) {
    return rows.map((l: any) => ({
      leg_index: (Number(l.leg_index) === 2 ? 2 : 1) as 1 | 2,
      leg_date: String(l.leg_date ?? "").slice(0, 10),
      pickup_time: l.pickup_time ? String(l.pickup_time).slice(0, 5) : null,
      pickup_odometer: Number(l.pickup_odometer ?? 0),
      pickup_address: l.pickup_address ?? "",
      dropoff_time: l.dropoff_time ? String(l.dropoff_time).slice(0, 5) : null,
      dropoff_odometer: Number(l.dropoff_odometer ?? 0),
      dropoff_address: l.dropoff_address ?? "",
    }));
  }

  const pickupAt = trip.pickup_at ? new Date(trip.pickup_at) : new Date();
  const date = Number.isNaN(pickupAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : pickupAt.toISOString().slice(0, 10);
  const time = Number.isNaN(pickupAt.getTime()) ? null : pickupAt.toTimeString().slice(0, 5);

  return [
    {
      leg_index: 1,
      leg_date: date,
      pickup_time: time,
      pickup_odometer: Number(trip.odometer_start ?? 0),
      pickup_address: trip.pickup_address ?? "",
      dropoff_time: null,
      dropoff_odometer: Number(trip.odometer_end ?? 0),
      dropoff_address: trip.dropoff_address ?? "",
    },
  ];
}
