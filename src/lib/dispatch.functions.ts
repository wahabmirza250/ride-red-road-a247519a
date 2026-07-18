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
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, status, pickup_address, pickup_lat, pickup_lng, dropoff_address, driver_id, declined_driver_ids",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");
    if (req.status !== "pending") return { assigned: null, reason: "not_pending" };

    if (req.pickup_lat == null || req.pickup_lng == null) {
      return { assigned: null, reason: "no_pickup_coords" };
    }

    const pickup: Coord = { lat: Number(req.pickup_lat), lng: Number(req.pickup_lng) };
    const declined = (req.declined_driver_ids ?? []) as string[];

    const { data: drivers, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, current_lat, current_lng, status")
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
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        passenger_id: context.userId,
        pickup_address: data.pickup_address.trim(),
        pickup_lat: data.pickup_lat,
        pickup_lng: data.pickup_lng,
        dropoff_address: data.dropoff_address.trim(),
        dropoff_lat: data.dropoff_lat,
        dropoff_lng: data.dropoff_lng,
        requested_pickup_time: data.requested_pickup_time || null,
        notes: data.notes?.trim() || null,
        contact_name: data.contact_name?.trim() || null,
        contact_phone: data.contact_phone?.trim() || null,
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
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");

    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
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
        status: "pending",
        source: "dispatcher",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create ride request");

    const dispatch = await dispatchRideRequest({ data: { request_id: inserted.id } });
    return { request_id: inserted.id, ...dispatch };
  });
