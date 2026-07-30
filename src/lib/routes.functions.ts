import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildGoogleMapsRouteUrl } from "@/lib/googleMapsRoute";

export type RouteStopInput = {
  kind: "pickup" | "dropoff" | "stop";
  leg?: "outbound" | "return";
  passenger_name?: string | null;
  passenger_phone?: string | null;
  passenger_medicaid_id?: string | null;
  address: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  request_id?: string | null;
};

type Pt = { lat: number; lng: number };
function km(a: Pt, b: Pt) {
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

type Seqable = {
  id?: string;
  kind: string;
  leg: string;
  passenger_name?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Nearest-next-stop ordering that respects the rules a real route needs:
 *   - a passenger's pickup always precedes their dropoff on the same leg
 *   - a round-trip passenger's return pickup only becomes eligible after
 *     their outbound dropoff
 * Stops without coordinates keep their relative order at the end.
 */
export function autoSequence<T extends Seqable>(stops: T[], origin?: Pt | null): T[] {
  const key = (s: Seqable) => `${(s.passenger_name ?? "").toLowerCase()}|${s.leg}`;
  const remaining = [...stops];
  const ordered: T[] = [];
  const done = new Set<string>();
  let cursor: Pt | null = origin ?? null;

  const eligible = (s: T) => {
    if (s.kind === "pickup") {
      if (s.leg === "return") {
        // return pickup requires the outbound dropoff to be placed
        return done.has(`dropoff|${(s.passenger_name ?? "").toLowerCase()}|outbound`);
      }
      return true;
    }
    if (s.kind === "dropoff") return done.has(`pickup|${key(s)}`);
    return true;
  };

  while (remaining.length) {
    const pool = remaining.filter(eligible);
    const searchIn = pool.length ? pool : remaining;
    let best = searchIn[0];
    if (cursor) {
      let bestD = Infinity;
      for (const s of searchIn) {
        if (s.lat == null || s.lng == null) continue;
        const d = km(cursor, { lat: Number(s.lat), lng: Number(s.lng) });
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    remaining.splice(remaining.indexOf(best), 1);
    ordered.push(best);
    done.add(`${best.kind}|${key(best)}`);
    if (best.lat != null && best.lng != null) {
      cursor = { lat: Number(best.lat), lng: Number(best.lng) };
    }
  }
  return ordered;
}

async function loadRoute(routeId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: route, error } = await supabaseAdmin
    .from("routes")
    .select("*")
    .eq("id", routeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!route) throw new Error("Route not found");
  const { data: stops } = await supabaseAdmin
    .from("route_stops")
    .select("*")
    .eq("route_id", routeId)
    .order("sequence", { ascending: true });

  let driver_name: string | null = null;
  if (route.driver_id) {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("user_id")
      .eq("id", route.driver_id)
      .maybeSingle();
    if (drv?.user_id) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", drv.user_id)
        .maybeSingle();
      driver_name =
        `${prof?.first_name ?? ""} ${prof?.last_name ?? ""}`.trim() ||
        prof?.email ||
        "Driver";
    }
  }

  const list = stops ?? [];
  return {
    route: { ...route, driver_name },
    stops: list,
    mapsUrl: buildGoogleMapsRouteUrl(
      list.map((s) => ({ address: s.address, lat: s.lat, lng: s.lng })),
    ),
  };
}

async function renumber(routeId: string, orderedIds: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < orderedIds.length; i++) {
    await supabaseAdmin
      .from("route_stops")
      .update({ sequence: i + 1 })
      .eq("id", orderedIds[i]);
  }
}

/** Staff creates a multi-passenger route from explicit stops. */
export const createRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      name?: string | null;
      scheduled_at?: string | null;
      driver_id?: string | null;
      notes?: string | null;
      stops: RouteStopInput[];
      auto_sequence?: boolean;
    }) => {
      if (!input?.stops?.length) throw new Error("At least one stop required");
      for (const s of input.stops) {
        if (!s.address?.trim()) throw new Error("Every stop needs an address");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: route, error } = await supabaseAdmin
      .from("routes")
      .insert({
        name: data.name?.trim() || null,
        scheduled_at: data.scheduled_at || null,
        driver_id: data.driver_id || null,
        notes: data.notes?.trim() || null,
        status: data.driver_id ? "assigned" : "draft",
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !route) throw new Error(error?.message ?? "Could not create route");

    const prepared = data.auto_sequence === false
      ? data.stops.map((s) => ({ ...s, leg: s.leg ?? "outbound" }))
      : autoSequence(
          data.stops.map((s) => ({ ...s, leg: s.leg ?? "outbound" })),
          data.stops[0]?.lat != null && data.stops[0]?.lng != null
            ? { lat: Number(data.stops[0].lat), lng: Number(data.stops[0].lng) }
            : null,
        );

    const rows = prepared.map((s, i) => ({
      route_id: route.id,
      sequence: i + 1,
      kind: s.kind,
      leg: s.leg ?? "outbound",
      passenger_name: s.passenger_name ?? null,
      passenger_phone: s.passenger_phone ?? null,
      passenger_medicaid_id: s.passenger_medicaid_id ?? null,
      address: s.address.trim(),
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      notes: s.notes ?? null,
      request_id: s.request_id ?? null,
    }));
    const { error: sErr } = await supabaseAdmin.from("route_stops").insert(rows);
    if (sErr) throw new Error(sErr.message);

    await logDispatchEvent({
      kind: "route_created",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      route_id: route.id,
      driver_id: data.driver_id ?? null,
      summary: `Created route "${route.name ?? route.id.slice(0, 8)}" with ${rows.length} stops`,
    });

    return loadRoute(route.id);
  });

/** Batch route-building: turn selected pending requests into one multi-stop route. */
export const buildRouteFromRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request_ids: string[];
      name?: string | null;
      driver_id?: string | null;
      round_trip_request_ids?: string[];
    }) => {
      if (!input?.request_ids?.length) throw new Error("Select at least one request");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: reqs, error } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id, contact_name, contact_phone, contact_medicaid, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, notes, requested_pickup_time",
      )
      .in("id", data.request_ids);
    if (error) throw new Error(error.message);
    if (!reqs?.length) throw new Error("No matching ride requests");

    const roundTrip = new Set(data.round_trip_request_ids ?? []);
    const stops: RouteStopInput[] = [];
    for (const r of reqs) {
      const who = r.contact_name || "Passenger";
      stops.push({
        kind: "pickup",
        leg: "outbound",
        passenger_name: who,
        passenger_phone: r.contact_phone,
        passenger_medicaid_id: r.contact_medicaid,
        address: r.pickup_address,
        lat: r.pickup_lat == null ? null : Number(r.pickup_lat),
        lng: r.pickup_lng == null ? null : Number(r.pickup_lng),
        notes: r.notes,
        request_id: r.id,
      });
      stops.push({
        kind: "dropoff",
        leg: "outbound",
        passenger_name: who,
        passenger_phone: r.contact_phone,
        address: r.dropoff_address,
        lat: r.dropoff_lat == null ? null : Number(r.dropoff_lat),
        lng: r.dropoff_lng == null ? null : Number(r.dropoff_lng),
        request_id: r.id,
      });
      if (roundTrip.has(r.id)) {
        stops.push({
          kind: "pickup",
          leg: "return",
          passenger_name: who,
          passenger_phone: r.contact_phone,
          address: r.dropoff_address,
          lat: r.dropoff_lat == null ? null : Number(r.dropoff_lat),
          lng: r.dropoff_lng == null ? null : Number(r.dropoff_lng),
          notes: "Round trip — return leg",
          request_id: r.id,
        });
        stops.push({
          kind: "dropoff",
          leg: "return",
          passenger_name: who,
          passenger_phone: r.contact_phone,
          address: r.pickup_address,
          lat: r.pickup_lat == null ? null : Number(r.pickup_lat),
          lng: r.pickup_lng == null ? null : Number(r.pickup_lng),
          notes: "Round trip — home",
          request_id: r.id,
        });
      }
    }

    const first = stops[0];
    const ordered = autoSequence(
      stops.map((s) => ({ ...s, leg: s.leg ?? "outbound" })),
      first?.lat != null && first?.lng != null
        ? { lat: Number(first.lat), lng: Number(first.lng) }
        : null,
    );

    const { data: route, error: rErr } = await supabaseAdmin
      .from("routes")
      .insert({
        name:
          data.name?.trim() ||
          `Route · ${reqs.length} passenger${reqs.length > 1 ? "s" : ""}`,
        driver_id: data.driver_id || null,
        status: data.driver_id ? "assigned" : "draft",
        scheduled_at: reqs.find((r) => r.requested_pickup_time)?.requested_pickup_time ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (rErr || !route) throw new Error(rErr?.message ?? "Could not create route");

    const { error: sErr } = await supabaseAdmin.from("route_stops").insert(
      ordered.map((s, i) => ({
        route_id: route.id,
        sequence: i + 1,
        kind: s.kind,
        leg: s.leg ?? "outbound",
        passenger_name: s.passenger_name ?? null,
        passenger_phone: s.passenger_phone ?? null,
        passenger_medicaid_id: s.passenger_medicaid_id ?? null,
        address: s.address,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        notes: s.notes ?? null,
        request_id: s.request_id ?? null,
      })),
    );
    if (sErr) throw new Error(sErr.message);

    await logDispatchEvent({
      kind: "route_created",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      route_id: route.id,
      driver_id: data.driver_id ?? null,
      summary: `Built route from ${reqs.length} request(s) — ${ordered.length} stops`,
      data: { request_ids: data.request_ids },
    });

    return loadRoute(route.id);
  });

export const getRoute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { route_id: string }) => {
    if (!input?.route_id) throw new Error("route_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Staff sees any route; a driver sees only their own.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some(
      (r) => r.role === "admin" || r.role === "dispatch",
    );
    if (!isStaff) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      const { data: route } = await supabaseAdmin
        .from("routes")
        .select("driver_id")
        .eq("id", data.route_id)
        .maybeSingle();
      if (!drv || !route || route.driver_id !== drv.id) throw new Error("Not authorized");
    }
    return loadRoute(data.route_id);
  });

export const listRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: string; date?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("routes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data?.status) q = q.eq("status", data.status);
    if (data?.date) {
      q = q
        .gte("scheduled_at", `${data.date}T00:00:00.000Z`)
        .lte("scheduled_at", `${data.date}T23:59:59.999Z`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const counts = new Map<string, { total: number; done: number }>();
    if (ids.length) {
      const { data: stops } = await supabaseAdmin
        .from("route_stops")
        .select("route_id, completed_at")
        .in("route_id", ids);
      (stops ?? []).forEach((s) => {
        const c = counts.get(s.route_id) ?? { total: 0, done: 0 };
        c.total += 1;
        if (s.completed_at) c.done += 1;
        counts.set(s.route_id, c);
      });
    }
    return (rows ?? []).map((r) => ({
      ...r,
      stop_count: counts.get(r.id)?.total ?? 0,
      stops_done: counts.get(r.id)?.done ?? 0,
    }));
  });

export const reorderRouteStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { route_id: string; ordered_stop_ids: string[] }) => {
    if (!input?.route_id || !input.ordered_stop_ids?.length)
      throw new Error("route_id and ordered_stop_ids required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    await renumber(data.route_id, data.ordered_stop_ids);
    return loadRoute(data.route_id);
  });

/** Re-run nearest-next-stop sequencing as a starting suggestion. */
export const autoSequenceRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { route_id: string }) => {
    if (!input?.route_id) throw new Error("route_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stops } = await supabaseAdmin
      .from("route_stops")
      .select("*")
      .eq("route_id", data.route_id)
      .order("sequence", { ascending: true });
    if (!stops?.length) return loadRoute(data.route_id);

    const first = stops[0];
    const ordered = autoSequence(
      stops.map((s) => ({ ...s, leg: s.leg ?? "outbound" })),
      first.lat != null && first.lng != null
        ? { lat: Number(first.lat), lng: Number(first.lng) }
        : null,
    );
    await renumber(data.route_id, ordered.map((s) => s.id as string));
    return loadRoute(data.route_id);
  });

export const addRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: RouteStopInput & { route_id: string; position?: number }) => {
      if (!input?.route_id) throw new Error("route_id required");
      if (!input.address?.trim()) throw new Error("Address required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Staff or the route's own driver may add a stop mid-route.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some(
      (r) => r.role === "admin" || r.role === "dispatch",
    );
    if (!isStaff) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      const { data: route } = await supabaseAdmin
        .from("routes")
        .select("driver_id")
        .eq("id", data.route_id)
        .maybeSingle();
      if (!drv || route?.driver_id !== drv.id) throw new Error("Not your route");
    }

    const { data: existing } = await supabaseAdmin
      .from("route_stops")
      .select("id, sequence")
      .eq("route_id", data.route_id)
      .order("sequence", { ascending: true });

    const at = data.position ?? (existing?.length ?? 0) + 1;
    const { data: row, error } = await supabaseAdmin
      .from("route_stops")
      .insert({
        route_id: data.route_id,
        sequence: at,
        kind: data.kind ?? "stop",
        leg: data.leg ?? "outbound",
        passenger_name: data.passenger_name ?? null,
        passenger_phone: data.passenger_phone ?? null,
        passenger_medicaid_id: data.passenger_medicaid_id ?? null,
        address: data.address.trim(),
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        notes: data.notes ?? null,
        request_id: data.request_id ?? null,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not add stop");

    // Reflow sequences so inserts land in the requested position.
    const ids = [
      ...(existing ?? []).slice(0, at - 1).map((s) => s.id),
      row.id,
      ...(existing ?? []).slice(at - 1).map((s) => s.id),
    ];
    await renumber(data.route_id, ids);
    return loadRoute(data.route_id);
  });

export const updateRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      stop_id: string;
      address?: string;
      lat?: number | null;
      lng?: number | null;
      notes?: string | null;
      passenger_name?: string | null;
    }) => {
      if (!input?.stop_id) throw new Error("stop_id required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stop } = await supabaseAdmin
      .from("route_stops")
      .select("route_id")
      .eq("id", data.stop_id)
      .maybeSingle();
    if (!stop) throw new Error("Stop not found");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some(
      (r) => r.role === "admin" || r.role === "dispatch",
    );
    if (!isStaff) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      const { data: route } = await supabaseAdmin
        .from("routes")
        .select("driver_id")
        .eq("id", stop.route_id)
        .maybeSingle();
      if (!drv || route?.driver_id !== drv.id) throw new Error("Not your route");
    }

    const patch: {
      address?: string;
      lat?: number | null;
      lng?: number | null;
      notes?: string | null;
      passenger_name?: string | null;
    } = {};
    if (data.address !== undefined) patch.address = data.address.trim();
    if (data.lat !== undefined) patch.lat = data.lat;
    if (data.lng !== undefined) patch.lng = data.lng;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.passenger_name !== undefined) patch.passenger_name = data.passenger_name;

    const { error } = await supabaseAdmin
      .from("route_stops")
      .update(patch)
      .eq("id", data.stop_id);
    if (error) throw new Error(error.message);
    return loadRoute(stop.route_id);
  });

export const removeRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stop_id: string }) => {
    if (!input?.stop_id) throw new Error("stop_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stop } = await supabaseAdmin
      .from("route_stops")
      .select("route_id")
      .eq("id", data.stop_id)
      .maybeSingle();
    if (!stop) throw new Error("Stop not found");
    await supabaseAdmin.from("route_stops").delete().eq("id", data.stop_id);
    const { data: rest } = await supabaseAdmin
      .from("route_stops")
      .select("id")
      .eq("route_id", stop.route_id)
      .order("sequence", { ascending: true });
    await renumber(stop.route_id, (rest ?? []).map((s) => s.id));
    return loadRoute(stop.route_id);
  });

export const assignRouteDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { route_id: string; driver_id: string | null }) => {
    if (!input?.route_id) throw new Error("route_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("routes")
      .update({
        driver_id: data.driver_id,
        status: data.driver_id ? "assigned" : "draft",
      })
      .eq("id", data.route_id);
    if (error) throw new Error(error.message);

    if (data.driver_id) {
      // A route is real work: turn its requests into assigned trips so the
      // driver's in-trip flow (odometer, identity, signature, HCPF PDF) runs.
      const { materializeRouteTrips } = await import("@/lib/routeTrips.server");
      await materializeRouteTrips(data.route_id, data.driver_id);


      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("user_id")
        .eq("id", data.driver_id)
        .maybeSingle();
      if (drv?.user_id) {
        try {
          const { sendPushToUsers } = await import("@/lib/pushSend.server");
          await sendPushToUsers([drv.user_id], {
            title: "New route assigned",
            body: "Open the driver app to see your stop list.",
            url: "/driver",
            tag: `route-${data.route_id}`,
          });
        } catch (e) {
          console.warn("[assignRouteDriver] push failed", e);
        }
      }
    }

    await logDispatchEvent({
      kind: "route_assigned",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      route_id: data.route_id,
      driver_id: data.driver_id,
      summary: data.driver_id ? "Assigned route to driver" : "Unassigned route",
    });

    return loadRoute(data.route_id);
  });

/** Driver marks a stop complete; the route advances and finishes automatically. */
export const completeRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stop_id: string; undo?: boolean }) => {
    if (!input?.stop_id) throw new Error("stop_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stop } = await supabaseAdmin
      .from("route_stops")
      .select("route_id")
      .eq("id", data.stop_id)
      .maybeSingle();
    if (!stop) throw new Error("Stop not found");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some(
      (r) => r.role === "admin" || r.role === "dispatch",
    );
    if (!isStaff) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      const { data: route } = await supabaseAdmin
        .from("routes")
        .select("driver_id")
        .eq("id", stop.route_id)
        .maybeSingle();
      if (!drv || route?.driver_id !== drv.id) throw new Error("Not your route");
    }

    await supabaseAdmin
      .from("route_stops")
      .update({ completed_at: data.undo ? null : new Date().toISOString() })
      .eq("id", data.stop_id);

    const { data: all } = await supabaseAdmin
      .from("route_stops")
      .select("completed_at")
      .eq("route_id", stop.route_id);
    const total = all?.length ?? 0;
    const done = (all ?? []).filter((s) => s.completed_at).length;

    await supabaseAdmin
      .from("routes")
      .update({
        status: done === 0 ? "assigned" : done >= total ? "completed" : "in_progress",
        started_at: done > 0 ? new Date().toISOString() : null,
        completed_at: done >= total && total > 0 ? new Date().toISOString() : null,
      })
      .eq("id", stop.route_id);

    return loadRoute(stop.route_id);
  });

/** The signed-in driver's current (assigned or in-progress) route, if any. */
export const getMyActiveRoute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!drv) return null;
    const { data: route } = await supabaseAdmin
      .from("routes")
      .select("id")
      .eq("driver_id", drv.id)
      .in("status", ["assigned", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!route) return null;
    return loadRoute(route.id);
  });
