import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * A dispatcher-directed assignment is not a race between nearby drivers — it is
 * a deliberate hand-off — so it gets a much longer window than the 30s
 * auto-dispatch offer before the ride is reclaimed and re-broadcast.
 */
const OFFER_TTL_MS = 10 * 60_000;

/**
 * Staff (admin OR dispatch) assigns / re-assigns a ride to a specific driver.
 * Works whether the ride is still pending (offer stage) or already accepted.
 *
 *  - pending  → sets ride_requests.driver_id, resets offer TTL, notifies the driver.
 *  - accepted → transfers trips.driver_id, flips old driver to "available"
 *               and new driver to "busy".
 */
export const adminReassignDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string; driver_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    if (!input?.driver_id) throw new Error("driver_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, status, driver_id, trip_id, pickup_address, dropoff_address",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");

    const { data: newDriver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, status")
      .eq("id", data.driver_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!newDriver) throw new Error("Selected driver not found");

    const oldDriverId = req.driver_id;
    const expires = new Date(Date.now() + OFFER_TTL_MS).toISOString();

    if (oldDriverId === newDriver.id) {
      // Same driver re-selected. If the ride is still at offer stage, this is a
      // dispatcher re-poke: refresh the (possibly expired) offer window so the
      // driver can still accept, instead of silently doing nothing.
      if (req.status === "pending" || !req.trip_id) {
        const { error: refreshErr } = await supabaseAdmin
          .from("ride_requests")
          .update({ offer_expires_at: expires, declined_driver_ids: [] })
          .eq("id", req.id);
        if (refreshErr) throw new Error(refreshErr.message);
        return { ok: true, refreshed: true };
      }
      return { ok: true, unchanged: true };
    }


    if (req.status === "pending" || !req.trip_id) {
      // Still at offer stage: retarget the offer.
      const { error: upErr } = await supabaseAdmin
        .from("ride_requests")
        .update({
          driver_id: newDriver.id,
          offer_expires_at: expires,
          declined_driver_ids: [],
        })
        .eq("id", req.id);
      if (upErr) throw new Error(upErr.message);
    } else {
      // Accepted / active trip: hand the trip off in-flight.
      const { error: tripErr } = await supabaseAdmin
        .from("trips")
        .update({ driver_id: newDriver.id, assignment_type: "manual" })
        .eq("id", req.trip_id);
      if (tripErr) throw new Error(tripErr.message);

      const { error: reqUpErr } = await supabaseAdmin
        .from("ride_requests")
        .update({ driver_id: newDriver.id })
        .eq("id", req.id);
      if (reqUpErr) throw new Error(reqUpErr.message);

      if (oldDriverId) {
        await supabaseAdmin
          .from("drivers")
          .update({ status: "available" })
          .eq("id", oldDriverId);
      }
      await supabaseAdmin
        .from("drivers")
        .update({ status: "busy" })
        .eq("id", newDriver.id);
    }

    await logDispatchEvent({
      kind: oldDriverId ? "reassign" : "assign",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      request_id: req.id,
      trip_id: req.trip_id,
      driver_id: newDriver.id,
      summary: `${oldDriverId ? "Reassigned" : "Assigned"} ride ${req.pickup_address} → ${req.dropoff_address}`,
      data: { previous_driver_id: oldDriverId, status: req.status },
    });

    // Notify the newly-assigned driver.
    try {
      const { sendPushToUsers } = await import("@/lib/pushSend.server");
      await sendPushToUsers([newDriver.user_id], {
        title:
          req.status === "pending"
            ? "New ride request"
            : "Ride reassigned to you",
        body: `${req.pickup_address} → ${req.dropoff_address}`,
        url: "/driver",
        tag: `ride-${req.id}`,
        requireInteraction: true,
      });
    } catch (e) {
      console.warn("[adminReassignDriver] push failed", e);
    }

    return { ok: true, driver_id: newDriver.id };
  });

/**
 * Staff-facing list of drivers eligible for manual assignment.
 * Includes offline drivers so staff can override — the UI marks status.
 */
export const adminListAssignableDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, user_id, status, current_lat, current_lng, last_location_at, default_vehicle_type, vehicle_make, vehicle_model, vehicle_plate",
      )
      .order("status", { ascending: true });
    if (error) throw new Error(error.message);

    const userIds = (data ?? []).map((d) => d.user_id).filter(Boolean);
    let names = new Map<string, string>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      names = new Map(
        (profs ?? []).map((p) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
            p.email ||
            "Driver",
        ]),
      );
    }
    return (data ?? []).map((d) => ({
      ...d,
      name: names.get(d.user_id) ?? "Driver",
    }));
  });

/**
 * Staff cancels a ride at any stage. Cancels the ride_request, the linked
 * trip (if one exists), and releases the assigned driver back to "available".
 */
export const adminCancelTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string; reason?: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select("id, driver_id, trip_id, status, pickup_address, dropoff_address")
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");

    await supabaseAdmin
      .from("ride_requests")
      .update({ status: "cancelled" })
      .eq("id", req.id);

    if (req.trip_id) {
      await supabaseAdmin
        .from("trips")
        .update({ status: "cancelled" })
        .eq("id", req.trip_id);
    }

    if (req.driver_id) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("user_id, status")
        .eq("id", req.driver_id)
        .maybeSingle();
      if (drv && drv.status === "busy") {
        await supabaseAdmin
          .from("drivers")
          .update({ status: "available" })
          .eq("id", req.driver_id);
      }
      if (drv?.user_id) {
        try {
          const { sendPushToUsers } = await import("@/lib/pushSend.server");
          await sendPushToUsers([drv.user_id], {
            title: "Trip cancelled by dispatch",
            body: data.reason ?? "This ride was cancelled.",
            url: "/driver",
            tag: `ride-${req.id}`,
          });
        } catch (e) {
          console.warn("[adminCancelTrip] push failed", e);
        }
      }
    }

    await logDispatchEvent({
      kind: "cancel",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      request_id: req.id,
      trip_id: req.trip_id,
      driver_id: req.driver_id,
      summary: `Cancelled ride ${req.pickup_address} → ${req.dropoff_address}`,
      data: { reason: data.reason ?? null },
    });

    return { ok: true };
  });
