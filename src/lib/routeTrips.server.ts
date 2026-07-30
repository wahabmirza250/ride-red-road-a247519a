/**
 * Turns the ride requests on a dispatcher-built route into real assigned trips
 * for the route's driver.
 *
 * Without this, a route was only a stop checklist: the driver never got an
 * active trip, so odometer capture, identity verification, the passenger
 * signature and the HCPF trip report / state PDF were unreachable for routed
 * work. Trips are created in route order so the driver's linear in-trip flow
 * follows exactly the sequence the dispatcher planned.
 */
export async function materializeRouteTrips(routeId: string, driverId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: route } = await supabaseAdmin
    .from("routes")
    .select("scheduled_at")
    .eq("id", routeId)
    .maybeSingle();

  const { data: stops } = await supabaseAdmin
    .from("route_stops")
    .select("request_id, sequence")
    .eq("route_id", routeId)
    .not("request_id", "is", null)
    .order("sequence", { ascending: true });

  // First appearance of each request defines its position in the run order.
  const order: string[] = [];
  for (const s of stops ?? []) {
    const id = s.request_id as string;
    if (!order.includes(id)) order.push(id);
  }
  if (!order.length) return { created: 0 };

  const base = route?.scheduled_at ? new Date(route.scheduled_at) : new Date();
  let created = 0;

  for (let i = 0; i < order.length; i++) {
    const requestId = order[i];
    const { data: req } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, passenger_id, contact_name, contact_phone, contact_medicaid, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, requested_pickup_time, estimated_fare, status, trip_id, ride_purpose",
      )
      .eq("id", requestId)
      .maybeSingle();
    if (!req) continue;

    // Already materialized — just make sure it points at this driver.
    if (req.trip_id) {
      await supabaseAdmin
        .from("trips")
        .update({ driver_id: driverId })
        .eq("id", req.trip_id)
        .in("status", ["scheduled", "assigned"]);
      await supabaseAdmin
        .from("ride_requests")
        .update({ driver_id: driverId })
        .eq("id", req.id);
      continue;
    }
    if (req.status !== "pending") continue;

    const passengerId = await resolvePassenger(supabaseAdmin, req);
    if (!passengerId) continue;

    const scheduled = new Date(base.getTime() + i * 60_000).toISOString();

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .insert({
        driver_id: driverId,
        passenger_id: passengerId,
        status: "assigned",
        pickup_address: req.pickup_address,
        pickup_lat: req.pickup_lat,
        pickup_lng: req.pickup_lng,
        dropoff_address: req.dropoff_address,
        dropoff_lat: req.dropoff_lat,
        dropoff_lng: req.dropoff_lng,
        estimated_fare: req.estimated_fare,
        scheduled_pickup_time: scheduled,
        assignment_type: "manual",
        ride_purpose: req.ride_purpose ?? null,
      })
      .select("id")
      .single();
    if (tripError || !trip) {
      console.warn("[materializeRouteTrips] trip insert failed", tripError);
      continue;
    }

    const { data: linked } = await supabaseAdmin
      .from("ride_requests")
      .update({
        status: "accepted",
        driver_id: driverId,
        trip_id: trip.id,
        offer_expires_at: null,
      })
      .eq("id", req.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!linked) {
      await supabaseAdmin.from("trips").delete().eq("id", trip.id);
      continue;
    }
    created++;
  }

  if (created > 0) {
    await supabaseAdmin.from("drivers").update({ status: "busy" }).eq("id", driverId);
  }
  return { created };
}

type ReqRow = {
  passenger_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_medicaid: string | null;
};

/** Mirrors acceptRideOffer's passenger resolution so routed trips bill correctly. */
async function resolvePassenger(
  admin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  req: ReqRow,
): Promise<string | null> {
  let passengerId = req.passenger_id ?? null;

  if (passengerId) {
    const { data: byId } = await admin
      .from("passengers")
      .select("id")
      .eq("id", passengerId)
      .maybeSingle();
    if (byId?.id) return byId.id;
    const { data: byUser } = await admin
      .from("passengers")
      .select("id")
      .eq("user_id", passengerId)
      .maybeSingle();
    passengerId = byUser?.id ?? null;
    if (passengerId) return passengerId;
  }

  if (req.contact_medicaid) {
    const { data: byMedicaid } = await admin
      .from("passengers")
      .select("id")
      .eq("medicaid_id", req.contact_medicaid)
      .maybeSingle();
    if (byMedicaid?.id) return byMedicaid.id;
  }

  if (req.contact_phone) {
    const { data: byPhone } = await admin
      .from("passengers")
      .select("id")
      .eq("phone", req.contact_phone)
      .maybeSingle();
    if (byPhone?.id) return byPhone.id;
  }

  const nameParts = (req.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
  const { data: inserted } = await admin
    .from("passengers")
    .insert({
      user_id: req.passenger_id || null,
      first_name: nameParts[0] || "Passenger",
      last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Guest",
      phone: req.contact_phone || null,
      medicaid_id: req.contact_medicaid || null,
      is_active: true,
    })
    .select("id")
    .single();
  return inserted?.id ?? null;
}
