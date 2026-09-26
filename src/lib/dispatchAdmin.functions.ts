import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * A dispatcher-directed assignment is not a race between nearby drivers — it is
 * a deliberate hand-off — so it gets a much longer window than the 30s
 * auto-dispatch offer before the ride is reclaimed and re-broadcast.
 */
const OFFER_TTL_MS = 10 * 60_000;

/** Staff assignment uses the same availability and conflict checks as Trips. Active journeys cannot be reassigned here. */
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
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, driver_id, trip_id, pickup_address, dropoff_address, company_id")
      .eq("id", data.request_id)
      .eq("company_id", callerCompany)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");

    const { data: newDriver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, status, company_id")
      .eq("id", data.driver_id)
      .eq("company_id", callerCompany)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!newDriver) throw new Error("Selected driver not found");

    const { data: assigned, error: assignError } = await context.supabase.rpc(
      "admin_assign_trip" as never,
      {
        p_trip: req.trip_id ?? req.id,
        p_driver: newDriver.id,
        p_preview: false,
        p_source: req.trip_id ? "dispatch" : "request",
      } as never,
    );
    if (assignError) throw new Error(assignError.message);
    const result = assigned as unknown as { changed?: boolean };
    if (result.changed) {
      await logDispatchEvent({
        kind: "assign",
        actor_id: context.userId,
        actor_role: isAdmin ? "admin" : "dispatch",
        request_id: req.id,
        trip_id: req.trip_id,
        driver_id: newDriver.id,
        summary: "Driver assignment confirmed",
      });
      try {
        const { sendPushToUsers } = await import("@/lib/pushSend.server");
        await sendPushToUsers([newDriver.user_id], {
          title: "Ride assigned to you",
          body: req.pickup_address + " → " + req.dropoff_address,
          url: "/driver",
          tag: "trip-" + (req.trip_id ?? req.id),
        });
      } catch {
        /* Realtime delivery remains available. */
      }
    }

    return { ok: true, driver_id: newDriver.id };
  });

/**
 * Staff-facing list of drivers eligible for manual assignment.
 * Lists driver status; confirmation rechecks eligibility on the server.
 */
export const adminListAssignableDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, user_id, status, current_lat, current_lng, last_location_at, default_vehicle_type, vehicle_make, vehicle_model, vehicle_plate",
      )
      .eq("company_id", callerCompany)
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
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Driver",
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

    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select("id, driver_id, trip_id, status, pickup_address, dropoff_address")
      .eq("id", data.request_id)
      .eq("company_id", callerCompany)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");

    const { error: cancelError } = await supabaseAdmin.rpc('update_company_dispatch_ride', {
      _company_id: callerCompany, _request_id: req.id, _action: 'cancel',
    });
    if (cancelError) throw new Error(cancelError.message);

    if (req.driver_id) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("user_id, status")
        .eq("id", req.driver_id)
        .eq("company_id", callerCompany)
        .maybeSingle();
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

    try {
      const { notifyDispatchers } = await import("@/lib/notifyStaff.server");
      await notifyDispatchers({
        kind: "ride_cancelled",
        title: "Ride cancelled by staff",
        body: `${req.pickup_address} → ${req.dropoff_address}`,
        url: "/dispatch",
        companyId: callerCompany,
        data: { ride_request_id: req.id, reason: data.reason ?? null },
      });
    } catch (e) {
      console.warn("[adminCancelTrip] alert failed", e);
    }

    return { ok: true };
  });

/**
 * Move a pending ride's requested pickup time (future scheduling in the
 * admin planner). Only rides that have not started yet may be moved.
 */
export const rescheduleRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string; requested_pickup_time: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    if (!input?.requested_pickup_time) throw new Error("Pickup time required");
    if (Number.isNaN(Date.parse(input.requested_pickup_time)))
      throw new Error("Invalid pickup time");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);

    const { data: req, error: rErr } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, trip_id")
      .eq("id", data.request_id)
      .eq("company_id", callerCompany)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!req) throw new Error("Ride request not found");
    if (!["pending", "accepted"].includes(String(req.status)))
      throw new Error("This ride can no longer be rescheduled");

    const iso = new Date(data.requested_pickup_time).toISOString();

    const { error } = await supabaseAdmin.rpc('update_company_dispatch_ride', {
      _company_id: callerCompany, _request_id: req.id, _action: 'reschedule', _pickup_at: iso,
    });
    if (error) throw new Error(error.message);

    await logDispatchEvent({
      kind: "ride_rescheduled",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      request_id: data.request_id,
      trip_id: req.trip_id,
      summary: `Rescheduled pickup to ${new Date(iso).toLocaleString()}`,
      data: { requested_pickup_time: iso },
    });

    return { ok: true, requested_pickup_time: iso };
  });
