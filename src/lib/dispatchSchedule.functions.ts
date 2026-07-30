import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Passenger picker for the dispatch "Add ride" form (staff only). */
export const dispatchListPassengers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, phone")
      .order("first_name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => ({
      id: p.id,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Passenger",
      medicaid_id: p.medicaid_id ?? "",
      phone: p.phone ?? "",
    }));
  });

type ScheduleInput = {
  passenger_id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  scheduled_pickup_time: string;
  driver_id?: string | null;
  notes?: string | null;
};

/**
 * Schedule a ride for now or any future date/time straight from the dispatch
 * board. Same shape as the admin planner's trip creation, but usable by the
 * dispatch role too (writes run through the service client after the staff
 * guard, since dispatch has no direct insert grant on trips).
 */
export const dispatchScheduleRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ScheduleInput) => {
    if (!input?.passenger_id) throw new Error("Pick a passenger");
    if (!input?.pickup_address?.trim()) throw new Error("Pickup address required");
    if (!input?.dropoff_address?.trim()) throw new Error("Drop-off address required");
    if (!input?.scheduled_pickup_time || Number.isNaN(Date.parse(input.scheduled_pickup_time)))
      throw new Error("Valid pickup date/time required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const driverId = data.driver_id || null;
    if (driverId) {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("id", driverId)
        .maybeSingle();
      if (!driver) throw new Error("Selected driver not found");
    }

    const iso = new Date(data.scheduled_pickup_time).toISOString();
    const { data: trip, error } = await supabaseAdmin
      .from("trips")
      .insert({
        passenger_id: data.passenger_id,
        driver_id: driverId,
        status: driverId ? "assigned" : "scheduled",
        pickup_address: data.pickup_address.trim(),
        dropoff_address: data.dropoff_address.trim(),
        pickup_lat: data.pickup_lat ?? null,
        pickup_lng: data.pickup_lng ?? null,
        dropoff_lat: data.dropoff_lat ?? null,
        dropoff_lng: data.dropoff_lng ?? null,
        scheduled_pickup_time: iso,
        assignment_type: "manual",
        notes: data.notes?.trim() || null,
      })
      .select("id, scheduled_pickup_time, status")
      .single();
    if (error) throw new Error(error.message);

    await logDispatchEvent({
      kind: "ride_scheduled",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      trip_id: trip.id,
      driver_id: driverId,
      summary: `Scheduled ride ${data.pickup_address} → ${data.dropoff_address} for ${new Date(iso).toLocaleString()}`,
      data: { scheduled_pickup_time: iso },
    });

    return trip;
  });
