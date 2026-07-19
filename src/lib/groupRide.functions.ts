import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Coord = { lat: number; lng: number };
function km(a: Coord, b: Coord) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest-neighbor ordering starting from `origin`. */
function orderNearest<T extends Coord>(origin: Coord, points: T[]): T[] {
  const remaining = [...points];
  const ordered: T[] = [];
  let cur = origin;
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = km(cur, remaining[i]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const [next] = remaining.splice(bestI, 1);
    ordered.push(next);
    cur = next;
  }
  return ordered;
}

type PaxIn = {
  name: string;
  phone?: string | null;
  medicaid_id?: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
};

/** Admin/dispatcher creates a group ride. Sequences pickups then dropoffs
 *  by nearest-neighbor and writes them as trip_stops when a trip is created. */
export const createGroupRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      passengers: PaxIn[];
      ride_purpose?: string | null;
      requested_pickup_time?: string | null;
      notes?: string | null;
    }) => {
      if (!input.passengers?.length) throw new Error("At least one passenger required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pax = data.passengers;
    // Sequence pickups starting from first passenger's pickup as origin.
    const pickupOrigin = { lat: pax[0].pickup_lat, lng: pax[0].pickup_lng };
    const pickupOrder = orderNearest(pickupOrigin, pax.map((p, i) => ({ ...p, i, lat: p.pickup_lat, lng: p.pickup_lng })));
    // Sequence dropoffs from the last pickup point.
    const lastPickup = pickupOrder[pickupOrder.length - 1];
    const dropoffOrder = orderNearest({ lat: lastPickup.lat, lng: lastPickup.lng },
      pax.map((p, i) => ({ ...p, i, lat: p.dropoff_lat, lng: p.dropoff_lng })));

    const primary = pax[0];
    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests").insert({
        passenger_id: null,
        pickup_address: primary.pickup_address,
        pickup_lat: primary.pickup_lat,
        pickup_lng: primary.pickup_lng,
        dropoff_address: pax[pax.length - 1].dropoff_address,
        dropoff_lat: pax[pax.length - 1].dropoff_lat,
        dropoff_lng: pax[pax.length - 1].dropoff_lng,
        requested_pickup_time: data.requested_pickup_time ?? null,
        notes: data.notes ?? null,
        contact_name: primary.name,
        contact_phone: primary.phone ?? null,
        contact_medicaid: primary.medicaid_id ?? null,
        status: "pending",
        source: "dispatcher_group",
        is_group: true,
        group_size: pax.length,
        ride_purpose: data.ride_purpose ?? null,
      }).select("*").single();
    if (reqErr || !req) throw new Error(reqErr?.message ?? "Failed to create group ride");

    // Insert manifest rows with sequences.
    const manifest = pax.map((p, i) => {
      const pickupSeq = pickupOrder.findIndex((x) => x.i === i) + 1;
      const dropoffSeq = dropoffOrder.findIndex((x) => x.i === i) + 1;
      return {
        request_id: req.id,
        name: p.name,
        phone: p.phone ?? null,
        medicaid_id: p.medicaid_id ?? null,
        pickup_address: p.pickup_address,
        pickup_lat: p.pickup_lat,
        pickup_lng: p.pickup_lng,
        dropoff_address: p.dropoff_address,
        dropoff_lat: p.dropoff_lat,
        dropoff_lng: p.dropoff_lng,
        pickup_sequence: pickupSeq,
        dropoff_sequence: dropoffSeq,
      };
    });
    const { error: manErr } = await supabaseAdmin.from("ride_passengers").insert(manifest);
    if (manErr) throw new Error(manErr.message);

    // Auto-dispatch
    const { dispatchRideRequest } = await import("@/lib/dispatch.functions");
    const dispatch = await dispatchRideRequest({ data: { request_id: req.id } });
    return { request_id: req.id, ...dispatch };
  });

/** Ordered stop list combining pickups then dropoffs for a group trip. */
export const getGroupManifest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id?: string; trip_id?: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = supabaseAdmin.from("ride_passengers").select("*");
    const { data: rows } = data.trip_id
      ? await q.eq("trip_id", data.trip_id)
      : await q.eq("request_id", data.request_id!);
    return rows ?? [];
  });
