// Server-only dispatch engine. Public callers must pass an authorization wrapper.
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

export async function dispatchRideInternal(data: { request_id: string; force?: boolean; quiet?: boolean }) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, status, company_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, driver_id, declined_driver_ids, vehicle_type, requested_pickup_time, is_group, offer_expires_at",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Ride request not found");
    if (req.status !== "pending") return { assigned: null, reason: "not_pending" };
    if (req.driver_id && req.offer_expires_at && Date.parse(req.offer_expires_at) > Date.now()) return {assigned:req.driver_id,reason:null};

    if (req.pickup_lat == null || req.pickup_lng == null) {
      return { assigned: null, reason: "no_pickup_coords" };
    }

    // TENANT ISOLATION: a request may only ever be offered to drivers of the
    // same company. Never widen this filter.
    if (!req.company_id) {
      return { assigned: null, reason: "no_company_on_request" };
    }

    const { eligibleForDispatch, isPickupDue } = await import('./dispatchEligibility');
    if (!isPickupDue(req.requested_pickup_time)) return { assigned: null, reason: 'scheduled_for_later' };
    // Group capacity is not yet modelled: let dispatch explicitly choose a suitable vehicle.
    if (req.is_group) return { assigned: null, reason: 'group_requires_manual_assignment' };
    const { data: company } = await supabaseAdmin.from('companies').select('status').eq('id', req.company_id).maybeSingle();
    if (company?.status !== 'active') return { assigned: null, reason: 'company_inactive' };
    if (!data.force) {
      const { data: setting, error } = await supabaseAdmin.from('app_settings').select('value')
        .eq('key', `company:${req.company_id}:auto_assign_enabled`).maybeSingle();
      if (error) throw new Error(error.message);
      if (String(setting?.value) !== 'true') return { assigned: null, reason: 'manual_dispatch' };
    }
    const { data: shifts, error: shiftError } = await supabaseAdmin.from('driver_shifts')
      .select('driver_id').eq('company_id', req.company_id).is('clock_out_at', null);
    if (shiftError) throw new Error(shiftError.message);
    const onShift = new Set((shifts ?? []).map(s => s.driver_id));

    const pickup: Coord = { lat: Number(req.pickup_lat), lng: Number(req.pickup_lng) };
    const declined = (req.declined_driver_ids ?? []) as string[];

    const { data: drivers, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, current_lat, current_lng, status, company_id, default_vehicle_type, last_location_at")
      .eq("company_id", req.company_id)
      .eq("status", "available");
    if (dErr) throw new Error(dErr.message);


    const eligible = (drivers ?? [])
      .filter(
        (d) =>
          eligibleForDispatch(d, req.vehicle_type, onShift.has(d.id)) &&
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
      try {
        if (data.quiet) return { assigned: null, reason: 'no_drivers_available' };
        const { notifyDispatchers } = await import("@/lib/notifyStaff.server");
        await notifyDispatchers({
          kind: "needs_manual_assignment",
          title: "No driver available — needs manual assignment",
          body: `${req.pickup_address} → ${req.dropoff_address}`,
          url: "/dispatch",
          companyId: (req as { company_id?: string | null }).company_id ?? null,
          data: { ride_request_id: req.id },
        });
      } catch (e) {
        console.warn("[dispatch] no-driver alert failed", e);
      }
      return { assigned: null, reason: "no_drivers_available" };
    }


    const target = eligible[0];
    const expires = new Date(Date.now() + OFFER_TTL_MS).toISOString();

    let assignment = supabaseAdmin
      .from("ride_requests")
      .update({ driver_id: target.id, offer_expires_at: expires })
      .eq("id", req.id)
      .eq("status", "pending");
    assignment = req.driver_id ? assignment.eq('driver_id', req.driver_id) : assignment.is('driver_id', null);
    const { data: assigned, error: upErr } = await assignment.select('id').maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (!assigned) return {assigned:null,reason:'assignment_changed'};

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
}
