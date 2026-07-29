import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureDriverOwnsTrip(userId: string, tripId: string, allowAdmin = true) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (allowAdmin) {
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (roleRow) return true;
  }
  const { data: driver } = await supabaseAdmin
    .from("drivers").select("id").eq("user_id", userId).maybeSingle();
  if (!driver) throw new Error("Not authorized");
  const { data: trip } = await supabaseAdmin
    .from("trips").select("id, driver_id").eq("id", tripId).maybeSingle();
  if (!trip || trip.driver_id !== driver.id) throw new Error("Not your trip");
  return true;
}

export const addTripStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      trip_id: string;
      address: string;
      lat?: number | null;
      lng?: number | null;
      passenger_name?: string | null;
      added_by?: "driver" | "passenger" | "dispatcher";
    }) => {
      if (!input.trip_id || !input.address) throw new Error("Trip and address required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureDriverOwnsTrip(context.userId, data.trip_id);
    const { data: existing } = await supabaseAdmin
      .from("trip_stops").select("sequence").eq("trip_id", data.trip_id)
      .order("sequence", { ascending: false }).limit(1).maybeSingle();
    const nextSeq = (existing?.sequence ?? 0) + 1;
    const { data: row, error } = await supabaseAdmin
      .from("trip_stops").insert({
        trip_id: data.trip_id,
        sequence: nextSeq,
        kind: "stop",
        address: data.address,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        passenger_name: data.passenger_name ?? null,
        added_by: data.added_by ?? "driver",
      }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const markStopArrived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stop_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stop } = await supabaseAdmin.from("trip_stops").select("trip_id").eq("id", data.stop_id).maybeSingle();
    if (!stop) throw new Error("Stop not found");
    await ensureDriverOwnsTrip(context.userId, stop.trip_id);
    await supabaseAdmin.from("trip_stops").update({ arrived_at: new Date().toISOString() }).eq("id", data.stop_id);
    return { ok: true };
  });

export const markStopDeparted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stop_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stop } = await supabaseAdmin.from("trip_stops").select("trip_id").eq("id", data.stop_id).maybeSingle();
    if (!stop) throw new Error("Stop not found");
    await ensureDriverOwnsTrip(context.userId, stop.trip_id);
    await supabaseAdmin.from("trip_stops").update({ departed_at: new Date().toISOString() }).eq("id", data.stop_id);
    return { ok: true };
  });

/**
 * Driver/admin correction of a trip's pickup or drop-off address mid-ride.
 * Drivers are blocked from writing these columns directly by the
 * `guard_trip_driver_update` trigger, so the change is applied with the
 * service role after ownership is verified here.
 */
export const updateTripAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      trip_id: string;
      which: "pickup" | "dropoff";
      address: string;
      lat?: number | null;
      lng?: number | null;
    }) => {
      if (!input?.trip_id) throw new Error("Trip required");
      if (!input.address?.trim()) throw new Error("Address required");
      if (input.which !== "pickup" && input.which !== "dropoff")
        throw new Error("Invalid address field");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureDriverOwnsTrip(context.userId, data.trip_id);

    const patch =
      data.which === "pickup"
        ? {
            pickup_address: data.address.trim(),
            pickup_lat: data.lat ?? null,
            pickup_lng: data.lng ?? null,
          }
        : {
            dropoff_address: data.address.trim(),
            dropoff_lat: data.lat ?? null,
            dropoff_lng: data.lng ?? null,
          };

    const { error } = await supabaseAdmin
      .from("trips")
      .update(patch)
      .eq("id", data.trip_id);
    if (error) throw new Error(error.message);

    // Keep the originating ride request in sync so dispatch sees the same
    // addresses on the board.
    const reqPatch =
      data.which === "pickup"
        ? {
            pickup_address: data.address.trim(),
            pickup_lat: data.lat ?? null,
            pickup_lng: data.lng ?? null,
          }
        : {
            dropoff_address: data.address.trim(),
            dropoff_lat: data.lat ?? null,
            dropoff_lng: data.lng ?? null,
          };
    await supabaseAdmin.from("ride_requests").update(reqPatch).eq("trip_id", data.trip_id);

    return { ok: true };
  });
