import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OFFER_TTL_MS = 30_000;

type Coord = { lat: number; lng: number };

function haversineKm(a: Coord, b: Coord) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Find nearest available driver (excluding declined list) and assign them the request.
 *  Idempotent: safe to call after a decline/timeout to re-dispatch.
 *  Returns { assigned: driverId | null, reason? }. */
export const dispatchRideRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { request_id: string; force?: boolean }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Company-level auto-assign gate. When OFF, requests stay unassigned in
    // the dispatch queue instead of auto-offering to the nearest driver.
    // The matching logic below is unchanged — only whether it fires.
    if (!data.force) {
      const { data: setting } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "auto_assign_enabled")
        .maybeSingle();
      if (String(setting?.value ?? "false").toLowerCase() !== "true") {
        return { assigned: null, reason: "manual_dispatch" };
      }
    }

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, status, company_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, driver_id, declined_driver_ids",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");
    if (req.status !== "pending") return { assigned: null, reason: "not_pending" };

    if (req.pickup_lat == null || req.pickup_lng == null) {
      return { assigned: null, reason: "no_pickup_coords" };
    }

    // TENANT ISOLATION: a request may only ever be offered to drivers of the
    // same company. Never widen this filter.
    if (!req.company_id) {
      return { assigned: null, reason: "no_company_on_request" };
    }

    const pickup: Coord = { lat: Number(req.pickup_lat), lng: Number(req.pickup_lng) };
    const declined = (req.declined_driver_ids ?? []) as string[];

    const { data: drivers, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, current_lat, current_lng, status, company_id")
      .eq("company_id", req.company_id)
      .eq("status", "available");
    if (dErr) throw new Error(dErr.message);


    const eligible = (drivers ?? [])
      .filter(
        (d) =>
          d.current_lat != null &&
          d.current_lng != null &&
          !declined.includes(d.id),
      )
      .map((d) => ({
        ...d,
        distance: haversineKm(pickup, {
          lat: Number(d.current_lat),
          lng: Number(d.current_lng),
        }),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (!eligible.length) {
      await supabaseAdmin
        .from("ride_requests")
        .update({ driver_id: null, offer_expires_at: null })
        .eq("id", req.id);
      return { assigned: null, reason: "no_drivers_available" };
    }

    const target = eligible[0];
    const expires = new Date(Date.now() + OFFER_TTL_MS).toISOString();

    const { error: upErr } = await supabaseAdmin
      .from("ride_requests")
      .update({ driver_id: target.id, offer_expires_at: expires })
      .eq("id", req.id)
      .eq("status", "pending");
    if (upErr) throw new Error(upErr.message);

    // Fire-and-forget push to the targeted driver.
    try {
      const { sendPushToUsers } = await import("@/lib/pushSend.server");
      await sendPushToUsers([target.user_id], {
        title: "New ride request",
        body: `${req.pickup_address} → ${req.dropoff_address}`,
        url: "/driver",
        tag: `ride-${req.id}`,
        requireInteraction: true,
      });
    } catch (e) {
      console.warn("[dispatch] push failed", e);
    }

    return { assigned: target.id, reason: null };
  });

/** Driver declines an offer. Adds self to declined list and re-dispatches. */
export const declineRideOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!driver) throw new Error("Not a driver");

    const { data: req } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, declined_driver_ids, driver_id")
      .eq("id", data.request_id)
      .maybeSingle();
    if (!req || req.status !== "pending") return { ok: true };

    const declined = new Set([...(req.declined_driver_ids ?? []), driver.id]);
    await supabaseAdmin
      .from("ride_requests")
      .update({
        declined_driver_ids: Array.from(declined),
        driver_id: null,
        offer_expires_at: null,
      })
      .eq("id", req.id);

    // Re-dispatch to next-nearest driver.
    await dispatchRideRequest({ data: { request_id: req.id } });
    return { ok: true };
  });

/** Expire a stale offer and re-dispatch. Safe for any signed-in caller (idempotent). */
export const expireRideOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, driver_id, offer_expires_at, declined_driver_ids")
      .eq("id", data.request_id)
      .maybeSingle();
    if (!req || req.status !== "pending") return { ok: true, expired: false };
    if (!req.offer_expires_at || new Date(req.offer_expires_at) > new Date()) {
      return { ok: true, expired: false };
    }
    const declined = new Set(req.declined_driver_ids ?? []);
    if (req.driver_id) declined.add(req.driver_id);
    await supabaseAdmin
      .from("ride_requests")
      .update({
        declined_driver_ids: Array.from(declined),
        driver_id: null,
        offer_expires_at: null,
      })
      .eq("id", req.id);
    await dispatchRideRequest({ data: { request_id: req.id } });
    return { ok: true, expired: true };
  });

/** Cancel a ride request at any point in its lifecycle. Public by design:
 * anyone with the ride_request id (the passenger link) may cancel — same trust
 * model as the passenger tracking page. Marks the ride_request cancelled, any
 * linked trip cancelled, and frees the assigned driver back to available. */
export const cancelRideRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { request_id: string; reason?: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, driver_id, trip_id")
      .eq("id", data.request_id)
      .maybeSingle();
    if (!req) throw new Error("Ride request not found");
    if (req.status === "cancelled" || req.status === "completed") {
      return { ok: true, already: true };
    }

    await supabaseAdmin
      .from("ride_requests")
      .update({
        status: "cancelled",
        driver_id: null,
        offer_expires_at: null,
      })
      .eq("id", req.id);


    if (req.trip_id) {
      await supabaseAdmin
        .from("trips")
        .update({ status: "cancelled" })
        .eq("id", req.trip_id);
    }

    if (req.driver_id) {
      await supabaseAdmin
        .from("drivers")
        .update({ status: "available" })
        .eq("id", req.driver_id)
        .eq("status", "busy");
    }

    return { ok: true, already: false };
  });



/** Driver accepts an assigned offer. Runs server-side so the request, driver,
 * passenger row, trip row, and driver status stay consistent. */
export const acceptRideOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isDriver } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "driver",
    });
    if (!isDriver) throw new Error("Driver only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (driverError) throw new Error(driverError.message);
    if (!driver) throw new Error("Driver profile not found");

    const { data: req, error: reqError } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, passenger_id, contact_name, contact_phone, contact_medicaid, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, requested_pickup_time, estimated_fare, status, driver_id, offer_expires_at, trip_id, ride_purpose, is_group, stops",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("Ride request not found");

    if (req.status === "accepted" && req.driver_id === driver.id && req.trip_id) {
      return { ok: true, trip_id: req.trip_id };
    }
    if (req.status !== "pending") throw new Error("Ride request is no longer available");
    if (req.driver_id && req.driver_id !== driver.id) {
      throw new Error("This ride is assigned to another driver");
    }
    if (req.offer_expires_at && new Date(req.offer_expires_at) < new Date()) {
      throw new Error("This ride offer expired");
    }

    let passengerId = req.passenger_id ?? null;

    if (passengerId) {
      const { data: byId } = await supabaseAdmin
        .from("passengers")
        .select("id")
        .eq("id", passengerId)
        .maybeSingle();
      if (byId?.id) {
        passengerId = byId.id;
      } else {
        const { data: byUser } = await supabaseAdmin
          .from("passengers")
          .select("id")
          .eq("user_id", passengerId)
          .maybeSingle();
        passengerId = byUser?.id ?? null;
      }
    }

    if (!passengerId && req.contact_medicaid) {
      const { data: byMedicaid } = await supabaseAdmin
        .from("passengers")
        .select("id")
        .eq("medicaid_id", req.contact_medicaid)
        .maybeSingle();
      passengerId = byMedicaid?.id ?? null;
    }

    if (!passengerId && req.contact_phone) {
      const { data: byPhone } = await supabaseAdmin
        .from("passengers")
        .select("id")
        .eq("phone", req.contact_phone)
        .maybeSingle();
      passengerId = byPhone?.id ?? null;
    }

    if (!passengerId) {
      let profile: {
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        email: string | null;
      } | null = null;

      if (req.passenger_id) {
        const { data: profileRow } = await supabaseAdmin
          .from("profiles")
          .select("first_name, last_name, phone, email")
          .eq("id", req.passenger_id)
          .maybeSingle();
        profile = profileRow;
      }

      const nameParts = (req.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
      const firstName = profile?.first_name?.trim() || nameParts[0] || "Passenger";
      const lastName =
        profile?.last_name?.trim() ||
        (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Guest");

      const { data: insertedPassenger, error: passengerError } = await supabaseAdmin
        .from("passengers")
        .insert({
          user_id: req.passenger_id || null,
          first_name: firstName,
          last_name: lastName,
          phone: req.contact_phone || profile?.phone || null,
          email: profile?.email || null,
          medicaid_id: req.contact_medicaid || null,
          is_active: true,
        })
        .select("id")
        .single();
      if (passengerError) throw new Error(passengerError.message);
      passengerId = insertedPassenger.id;
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .insert({
        driver_id: driver.id,
        passenger_id: passengerId,
        status: "assigned",
        pickup_address: req.pickup_address,
        pickup_lat: req.pickup_lat,
        pickup_lng: req.pickup_lng,
        dropoff_address: req.dropoff_address,
        dropoff_lat: req.dropoff_lat,
        dropoff_lng: req.dropoff_lng,
        estimated_fare: req.estimated_fare,
        scheduled_pickup_time: req.requested_pickup_time || new Date().toISOString(),
        assignment_type: "auto",
        ride_purpose: req.ride_purpose ?? null,
      })
      .select("id")
      .single();
    if (tripError || !trip) throw new Error(tripError?.message ?? "Failed to create trip");

    const { data: linked, error: linkError } = await supabaseAdmin
      .from("ride_requests")
      .update({
        status: "accepted",
        driver_id: driver.id,
        trip_id: trip.id,
        offer_expires_at: null,
      })
      .eq("id", req.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (linkError || !linked) {
      await supabaseAdmin.from("trips").delete().eq("id", trip.id);
      throw new Error(linkError?.message ?? "Ride request is no longer available");
    }


    // Group ride: attach manifest passengers to the trip and materialize
    // ordered pickup/dropoff stops from the pickup/dropoff sequence.
    if (req.is_group) {
      const { data: manifest } = await supabaseAdmin
        .from("ride_passengers").select("*").eq("request_id", req.id);
      if (manifest?.length) {
        await supabaseAdmin.from("ride_passengers")
          .update({ trip_id: trip.id }).eq("request_id", req.id);
        const stops = [
          ...manifest
            .slice()
            .sort((a, b) => (a.pickup_sequence ?? 0) - (b.pickup_sequence ?? 0))
            .map((m, i) => ({
              trip_id: trip.id, sequence: i + 1, kind: "pickup",
              address: m.pickup_address, lat: m.pickup_lat, lng: m.pickup_lng,
              passenger_name: m.name, passenger_medicaid_id: m.medicaid_id,
              added_by: "dispatcher",
            })),
          ...manifest
            .slice()
            .sort((a, b) => (a.dropoff_sequence ?? 0) - (b.dropoff_sequence ?? 0))
            .map((m, i) => ({
              trip_id: trip.id, sequence: 100 + i + 1, kind: "dropoff",
              address: m.dropoff_address, lat: m.dropoff_lat, lng: m.dropoff_lng,
              passenger_name: m.name, passenger_medicaid_id: m.medicaid_id,
              added_by: "dispatcher",
            })),
        ];
        await supabaseAdmin.from("trip_stops").insert(stops);
      }
    }

    // Passenger-added intermediate stops (optional, ordered).
    // Sequence 10..99 sits between pickup (implicit at trip origin) and dropoff.
    const passengerStops = Array.isArray(req.stops) ? req.stops : [];
    if (passengerStops.length) {
      const stopRows = passengerStops
        .filter((s: unknown): s is { address: string; lat: number; lng: number } =>
          !!s && typeof (s as { address?: unknown }).address === "string"
          && typeof (s as { lat?: unknown }).lat === "number"
          && typeof (s as { lng?: unknown }).lng === "number",
        )
        .map((s, i) => ({
          trip_id: trip.id,
          sequence: 10 + i,
          kind: "stop",
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          added_by: "passenger",
        }));
      if (stopRows.length) {
        const { error: stopsErr } = await supabaseAdmin.from("trip_stops").insert(stopRows);
        if (stopsErr) console.warn("[acceptRideOffer] failed to insert passenger stops", stopsErr);
      }
    }



    const { error: statusError } = await supabaseAdmin
      .from("drivers")
      .update({ status: "busy" })
      .eq("id", driver.id);
    if (statusError) throw new Error(statusError.message);

    return { ok: true, trip_id: trip.id };
  });

/** Signed-in passenger books a ride. Auto-dispatches to nearest driver. */
export const passengerRequestRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      pickup_address: string;
      pickup_lat: number;
      pickup_lng: number;
      dropoff_address: string;
      dropoff_lat: number;
      dropoff_lng: number;
      requested_pickup_time?: string | null;
      notes?: string | null;
      contact_name?: string | null;
      contact_phone?: string | null;
      ride_purpose?: string | null;
      stops?: Array<{ address: string; lat: number; lng: number }> | null;
    }) => {
      const req = (v: unknown, label: string) => {
        if (v == null || (typeof v === "string" && !v.trim()))
          throw new Error(`${label} required`);
      };
      req(input.pickup_address, "Pickup address");
      req(input.dropoff_address, "Drop-off address");
      req(input.pickup_lat, "Pickup coordinates");
      req(input.pickup_lng, "Pickup coordinates");
      req(input.dropoff_lat, "Drop-off coordinates");
      req(input.dropoff_lng, "Drop-off coordinates");
      // Normalize stops: keep only well-formed rows.
      const cleanStops = Array.isArray(input.stops)
        ? input.stops
            .filter((s) => s && typeof s.address === "string" && s.address.trim()
              && typeof s.lat === "number" && typeof s.lng === "number")
            .map((s) => ({ address: s.address.trim(), lat: s.lat, lng: s.lng }))
        : [];
      return { ...input, stops: cleanStops };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auto-save / refresh the passenger profile on every booking so first-time
    // passengers become permanent records without a separate "create profile"
    // step. Identity (Medicaid ID / SSN+DOB) is written by
    // updatePassengerIdentity and is NOT overwritten here.
    const name = (data.contact_name ?? "").trim();
    const nameParts = name.split(/\s+/).filter(Boolean);
    const first = nameParts[0] ?? "";
    const last = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
    const phone = data.contact_phone?.trim() || null;

    const { data: paxRow } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, phone")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (paxRow?.id) {
      const patch: { first_name?: string; last_name?: string; phone?: string | null } = {};
      if (first && !paxRow.first_name) patch.first_name = first;
      if (last && !paxRow.last_name) patch.last_name = last;
      if (phone && paxRow.phone !== phone) patch.phone = phone;
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("passengers").update(patch).eq("id", paxRow.id);
      }
    }

    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(context.userId);

    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        company_id: companyId,
        passenger_id: context.userId,

        pickup_address: data.pickup_address.trim(),
        pickup_lat: data.pickup_lat,
        pickup_lng: data.pickup_lng,
        dropoff_address: data.dropoff_address.trim(),
        dropoff_lat: data.dropoff_lat,
        dropoff_lng: data.dropoff_lng,
        requested_pickup_time: data.requested_pickup_time || null,
        notes: data.notes?.trim() || null,
        contact_name: name || null,
        contact_phone: phone,
        ride_purpose: data.ride_purpose ?? null,
        vehicle_type:
          data.notes?.match(/\[VEHICLE:([a-zA-Z_]+)\]/)?.[1]?.toLowerCase() ?? null,
        stops: data.stops ?? [],
        status: "pending",
        source: "passenger_app",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create ride request");

    const dispatch = await dispatchRideRequest({ data: { request_id: inserted.id } });
    return { request_id: inserted.id, ...dispatch };
  });

/** Admin/dispatcher creates a ride on behalf of a passenger. Auto-dispatches. */
export const dispatcherRequestRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      passenger_id?: string | null;
      pickup_address: string;
      pickup_lat: number;
      pickup_lng: number;
      dropoff_address: string;
      dropoff_lat: number;
      dropoff_lng: number;
      requested_pickup_time?: string | null;
      contact_name?: string | null;
      contact_phone?: string | null;
      notes?: string | null;
      vehicle_type?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireStaff } = await import("@/lib/staffGuard.server");
    const { requireCompanyId } = await import("@/lib/company.server");
    await requireStaff(context.userId);
    const companyId = await requireCompanyId(context.userId);

    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        company_id: companyId,
        passenger_id: data.passenger_id || null,

        pickup_address: data.pickup_address.trim(),
        pickup_lat: data.pickup_lat,
        pickup_lng: data.pickup_lng,
        dropoff_address: data.dropoff_address.trim(),
        dropoff_lat: data.dropoff_lat,
        dropoff_lng: data.dropoff_lng,
        requested_pickup_time: data.requested_pickup_time || null,
        contact_name: data.contact_name?.trim() || null,
        contact_phone: data.contact_phone?.trim() || null,
        notes: data.notes?.trim() || null,
        vehicle_type: data.vehicle_type ?? null,
        status: "pending",
        source: "dispatcher",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create ride request");

    const dispatch = await dispatchRideRequest({ data: { request_id: inserted.id } });
    return { request_id: inserted.id, ...dispatch };
  });

/** PUBLIC (auth optional) — estimated pickup minutes for each vehicle type
 *  from a given pickup coordinate. Returns null when no available driver
 *  of that type has GPS. Used by the passenger vehicle picker. */
export const getVehicleEtas = createServerFn({ method: "POST" })
  .inputValidator((input: { lat: number; lng: number }) => {
    if (input?.lat == null || input?.lng == null) throw new Error("Pickup coords required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: drivers } = await supabaseAdmin
      .from("drivers")
      .select("id, default_vehicle_type, current_lat, current_lng, status")
      .eq("status", "available");

    const pickup = { lat: data.lat, lng: data.lng };
    const bestByType: Record<string, number> = {};
    for (const d of drivers ?? []) {
      if (d.current_lat == null || d.current_lng == null) continue;
      const type = d.default_vehicle_type ?? "ambulatory";
      const km = haversineKm(pickup, { lat: Number(d.current_lat), lng: Number(d.current_lng) });
      const mins = Math.max(1, Math.round((km / 40) * 60));
      if (bestByType[type] == null || mins < bestByType[type]) bestByType[type] = mins;
    }
    return bestByType;
  });
