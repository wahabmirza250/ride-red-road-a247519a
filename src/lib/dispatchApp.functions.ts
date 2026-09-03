import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const STALE_GPS_MS = 10 * 60 * 1000;
const UNASSIGNED_WARN_MS = 5 * 60 * 1000;
const SOON_MS = 20 * 60 * 1000;

export type DispatchDriver = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  activity: "driving" | "idle" | "stale" | "offline";
  lat: number | null;
  lng: number | null;
  last_location_at: string | null;
  vehicle_type: string | null;
  vehicle_label: string | null;
  active_trip_id: string | null;
  active_trip_status: string | null;
  stale: boolean;
};

export type DispatchRequest = {
  id: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  trip_id: string | null;
  trip_status: string | null;
  passenger_name: string;
  passenger_phone: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  requested_pickup_time: string | null;
  vehicle_type: string | null;
  is_group: boolean;
  created_at: string;
  waiting_ms: number;
  minutes_to_pickup: number | null;
  urgency: "overdue" | "soon" | "scheduled" | "asap";
  flags: string[];
  suggested_driver_id: string | null;
  suggested_driver_name: string | null;
  suggested_driver_km: number | null;
};

/**
 * Single read powering the dispatch board: live requests, live drivers,
 * urgency + attention flags, nearest-idle-driver suggestions, and the
 * company auto-assign state.
 */
export const getDispatchBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    const { isAdmin, isDispatch } = await requireStaff(context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: driverRows }, { data: reqRows }, { data: settings }] =
      await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select(
            "id, user_id, status, current_lat, current_lng, last_location_at, default_vehicle_type, vehicle_make, vehicle_model, vehicle_plate",
          )
          .eq("company_id", callerCompany),
        supabaseAdmin
          .from("ride_requests")
          .select(
            "id, status, driver_id, trip_id, contact_name, contact_phone, pickup_address, dropoff_address, pickup_lat, pickup_lng, requested_pickup_time, vehicle_type, notes, is_group, created_at, passenger_id",
          )
          .eq("company_id", callerCompany)
          .in("status", ["pending", "accepted"])
          .order("created_at", { ascending: false })
          .limit(200),
        supabaseAdmin.from("app_settings").select("key, value"),
      ]);

    const settingMap = new Map(
      (settings ?? []).map((s) => [s.key, s.value ?? ""]),
    );

    // Names for drivers
    const driverUserIds = (driverRows ?? []).map((d) => d.user_id).filter(Boolean);
    const passengerUserIds = (reqRows ?? [])
      .map((r) => r.passenger_id)
      .filter(Boolean) as string[];
    const allIds = Array.from(new Set([...driverUserIds, ...passengerUserIds]));
    const nameMap = new Map<string, string>();
    if (allIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", allIds);
      (profs ?? []).forEach((p) =>
        nameMap.set(
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "",
        ),
      );
    }

    // Active trips per driver
    const { data: activeTrips } = await supabaseAdmin
      .from("trips")
      .select("id, driver_id, status, scheduled_pickup_time")
      .eq("company_id", callerCompany)
      .in("status", [
        "assigned",
        "driver_en_route_to_pickup",
        "arrived_at_pickup",
        "in_progress",
      ]);
    const tripByDriver = new Map<string, { id: string; status: string }>();
    (activeTrips ?? []).forEach((t) => {
      if (t.driver_id) tripByDriver.set(t.driver_id, { id: t.id, status: t.status });
    });
    const tripById = new Map(
      (activeTrips ?? []).map((t) => [t.id, t.status as string]),
    );

    const now = Date.now();

    const drivers: DispatchDriver[] = (driverRows ?? []).map((d) => {
      const lastLoc = d.last_location_at ? new Date(d.last_location_at).getTime() : 0;
      const stale = !lastLoc || now - lastLoc > STALE_GPS_MS;
      const trip = tripByDriver.get(d.id) ?? null;
      // Driver online/offline is authoritative. GPS freshness is shown
      // separately; denied/stale GPS must not make an online driver disappear.
      const activity: DispatchDriver["activity"] =
        d.status === "offline" ? "offline" : trip ? "driving" : "idle";
      return {
        id: d.id,
        user_id: d.user_id,
        name: nameMap.get(d.user_id) || "Driver",
        status: String(d.status),
        activity,
        lat: d.current_lat == null ? null : Number(d.current_lat),
        lng: d.current_lng == null ? null : Number(d.current_lng),
        last_location_at: d.last_location_at,
        vehicle_type: d.default_vehicle_type ? String(d.default_vehicle_type) : null,
        vehicle_label:
          [d.vehicle_make, d.vehicle_model].filter(Boolean).join(" ") ||
          d.vehicle_plate ||
          null,
        active_trip_id: trip?.id ?? null,
        active_trip_status: trip?.status ?? null,
        stale,
      };
    });

    const driverName = new Map(drivers.map((d) => [d.id, d.name]));

    const requests: DispatchRequest[] = (reqRows ?? []).map((r) => {
      const created = new Date(r.created_at).getTime();
      const waiting_ms = Math.max(0, now - created);
      const pickupAt = r.requested_pickup_time
        ? new Date(r.requested_pickup_time).getTime()
        : null;
      const minutes_to_pickup =
        pickupAt == null ? null : Math.round((pickupAt - now) / 60000);

      const vehicleType =
        r.vehicle_type ??
        r.notes?.match(/\[VEHICLE:([a-zA-Z_]+)\]/)?.[1]?.toLowerCase() ??
        null;

      const unassigned = !r.driver_id;
      const flags: string[] = [];
      if (unassigned && waiting_ms > UNASSIGNED_WARN_MS) flags.push("waiting_too_long");
      if (unassigned && minutes_to_pickup != null && minutes_to_pickup <= 20)
        flags.push("pickup_imminent_unassigned");
      if (minutes_to_pickup != null && minutes_to_pickup < 0) flags.push("running_late");

      const assignedDriver = r.driver_id
        ? drivers.find((d) => d.id === r.driver_id)
        : null;
      if (
        assignedDriver &&
        assignedDriver.stale &&
        assignedDriver.status !== "offline"
      )
        flags.push("driver_not_moving");

      let urgency: DispatchRequest["urgency"] = "asap";
      if (minutes_to_pickup == null) urgency = "asap";
      else if (minutes_to_pickup < 0) urgency = "overdue";
      else if (pickupAt! - now <= SOON_MS) urgency = "soon";
      else urgency = "scheduled";

      // Nearest idle driver suggestion — matching vehicle type first.
      let suggested: { id: string; name: string; km: number } | null = null;
      if (unassigned && r.pickup_lat != null && r.pickup_lng != null) {
        const pickup = { lat: Number(r.pickup_lat), lng: Number(r.pickup_lng) };
        const candidates = drivers
          .filter((d) => d.activity === "idle" && d.lat != null && d.lng != null)
          .map((d) => ({
            id: d.id,
            name: d.name,
            km: haversineKm(pickup, { lat: d.lat!, lng: d.lng! }),
            typeMatch: !vehicleType || d.vehicle_type === vehicleType,
          }))
          .sort((a, b) =>
            a.typeMatch === b.typeMatch ? a.km - b.km : a.typeMatch ? -1 : 1,
          );
        if (candidates.length) suggested = candidates[0];
      }

      return {
        id: r.id,
        status: r.status,
        driver_id: r.driver_id,
        driver_name: r.driver_id ? (driverName.get(r.driver_id) ?? null) : null,
        trip_id: r.trip_id,
        trip_status: r.trip_id ? (tripById.get(r.trip_id) ?? null) : null,
        passenger_name:
          r.contact_name ||
          (r.passenger_id ? nameMap.get(r.passenger_id) || "" : "") ||
          "Passenger",
        passenger_phone: r.contact_phone,
        pickup_address: r.pickup_address,
        dropoff_address: r.dropoff_address,
        pickup_lat: r.pickup_lat == null ? null : Number(r.pickup_lat),
        pickup_lng: r.pickup_lng == null ? null : Number(r.pickup_lng),
        requested_pickup_time: r.requested_pickup_time,
        vehicle_type: vehicleType,
        is_group: !!r.is_group,
        created_at: r.created_at,
        waiting_ms,
        minutes_to_pickup,
        urgency,
        flags,
        suggested_driver_id: suggested?.id ?? null,
        suggested_driver_name: suggested?.name ?? null,
        suggested_driver_km: suggested ? Number(suggested.km.toFixed(1)) : null,
      };
    });

    // Urgency sort: overdue → soon → asap → scheduled; unassigned first inside band.
    const bandRank: Record<DispatchRequest["urgency"], number> = {
      overdue: 0,
      soon: 1,
      asap: 2,
      scheduled: 3,
    };
    requests.sort((a, b) => {
      const r = bandRank[a.urgency] - bandRank[b.urgency];
      if (r !== 0) return r;
      const aU = a.driver_id ? 1 : 0;
      const bU = b.driver_id ? 1 : 0;
      if (aU !== bU) return aU - bU;
      return b.waiting_ms - a.waiting_ms;
    });

    return {
      requests,
      drivers,
      autoAssign:
        String(settingMap.get("auto_assign_enabled") ?? "false").toLowerCase() ===
        "true",
      dispatchPhone: settingMap.get("dispatch_phone_number") ?? null,
      viewer: { isAdmin, isDispatch },
    };
  });

/** Drivers scheduled/working today (night-before planning), plus who is online now. */
export const getTodaysSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { date?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const day = data?.date || new Date().toISOString().slice(0, 10);
    const dayStart = `${day}T00:00:00.000Z`;
    const dayEnd = `${day}T23:59:59.999Z`;

    const { data: companyDrivers } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, status, default_vehicle_type, last_location_at")
      .eq("company_id", callerCompany);
    const companyDriverIds = (companyDrivers ?? []).map((d) => d.id);

    const [{ data: shifts }, { data: scheduledTrips }] =
      await Promise.all([
        companyDriverIds.length
          ? supabaseAdmin
              .from("shifts")
              .select("id, driver_id, shift_date, start_time, end_time, status, notes")
              .in("driver_id", companyDriverIds)
              .eq("shift_date", day)
          : Promise.resolve({ data: [] as never[] }),
        supabaseAdmin
          .from("ride_requests")
          .select(
            "id, driver_id, status, contact_name, pickup_address, dropoff_address, requested_pickup_time, vehicle_type",
          )
          .eq("company_id", callerCompany)
          .gte("requested_pickup_time", dayStart)
          .lte("requested_pickup_time", dayEnd)
          .order("requested_pickup_time", { ascending: true }),
      ]);

    const driverRows = companyDrivers;
    const ids = (driverRows ?? []).map((d) => d.user_id).filter(Boolean);
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", ids);
      (profs ?? []).forEach((p) =>
        nameMap.set(
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Driver",
        ),
      );
    }

    const drivers = (driverRows ?? []).map((d) => ({
      id: d.id,
      name: nameMap.get(d.user_id) ?? "Driver",
      status: String(d.status),
      vehicle_type: d.default_vehicle_type ? String(d.default_vehicle_type) : null,
      online: String(d.status) !== "offline",
      shift: (shifts ?? []).find((s) => s.driver_id === d.id) ?? null,
    }));

    return {
      date: day,
      drivers,
      trips: (scheduledTrips ?? []).map((t) => ({
        ...t,
        driver_name: t.driver_id
          ? (drivers.find((d) => d.id === t.driver_id)?.name ?? null)
          : null,
      })),
    };
  });

/** Replay of a day's dispatch activity — audit evidence alongside trip PDFs. */
export const getDispatchDayHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { date?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const day = data?.date || new Date().toISOString().slice(0, 10);
    const dayStart = `${day}T00:00:00.000Z`;
    const dayEnd = `${day}T23:59:59.999Z`;

    const { data: companyDriverRows } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("company_id", callerCompany);
    const companyDriverIds = new Set((companyDriverRows ?? []).map((d) => d.id));

    const [{ data: allEvents }, { data: trips }] = await Promise.all([
      supabaseAdmin
        .from("dispatch_events")
        .select("*")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("trips")
        .select(
          "id, driver_id, status, created_at, actual_pickup_time, actual_dropoff_time, pickup_address, dropoff_address",
        )
        .eq("company_id", callerCompany)
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: true }),
    ]);

    const events = (allEvents ?? []).filter(
      (e) => !e.driver_id || companyDriverIds.has(e.driver_id),
    );

    const driverIds = Array.from(
      new Set([
        ...(events ?? []).map((e) => e.driver_id),
        ...(trips ?? []).map((t) => t.driver_id),
      ]),
    ).filter(Boolean) as string[];
    const driverName = new Map<string, string>();
    if (driverIds.length) {
      const { data: drvs } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id")
        .in("id", driverIds);
      const uids = (drvs ?? []).map((d) => d.user_id).filter(Boolean);
      const { data: profs } = uids.length
        ? await supabaseAdmin
            .from("profiles")
            .select("id, first_name, last_name, email")
            .in("id", uids)
        : { data: [] as never[] };
      const byUser = new Map(
        (profs ?? []).map((p) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Driver",
        ]),
      );
      (drvs ?? []).forEach((d) =>
        driverName.set(d.id, byUser.get(d.user_id) ?? "Driver"),
      );
    }

    return {
      date: day,
      events: (events ?? []).map((e) => ({
        ...e,
        driver_name: e.driver_id ? (driverName.get(e.driver_id) ?? null) : null,
      })),
      trips: (trips ?? []).map((t) => ({
        ...t,
        driver_name: t.driver_id ? (driverName.get(t.driver_id) ?? null) : null,
      })),
    };
  });

/**
 * Every pending / scheduled / future-dated ride, for admin planning.
 * Not limited to real-time activity like the live board.
 */
export const getPlannableRides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { from?: string; to?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { requireCompanyId } = await import("@/lib/company.server");
    const callerCompany = await requireCompanyId(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("ride_requests")
      .select(
        "id, status, driver_id, trip_id, contact_name, contact_phone, pickup_address, dropoff_address, requested_pickup_time, vehicle_type, notes, is_group, created_at",
      )
      .eq("company_id", callerCompany)
      .in("status", ["pending", "accepted"])
      .order("requested_pickup_time", { ascending: true, nullsFirst: false })
      .limit(500);
    if (data?.from) q = q.gte("requested_pickup_time", data.from);
    if (data?.to) q = q.lte("requested_pickup_time", data.to);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const driverIds = Array.from(
      new Set((rows ?? []).map((r) => r.driver_id).filter(Boolean)),
    ) as string[];
    const driverName = new Map<string, string>();
    if (driverIds.length) {
      const { data: drvs } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id")
        .in("id", driverIds);
      const uids = (drvs ?? []).map((d) => d.user_id).filter(Boolean);
      const { data: profs } = uids.length
        ? await supabaseAdmin
            .from("profiles")
            .select("id, first_name, last_name, email")
            .in("id", uids)
        : { data: [] as never[] };
      const byUser = new Map(
        (profs ?? []).map((p) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Driver",
        ]),
      );
      (drvs ?? []).forEach((d) =>
        driverName.set(d.id, byUser.get(d.user_id) ?? "Driver"),
      );
    }

    return (rows ?? []).map((r) => ({
      ...r,
      vehicle_type:
        r.vehicle_type ??
        r.notes?.match(/\[VEHICLE:([a-zA-Z_]+)\]/)?.[1]?.toLowerCase() ??
        null,
      driver_name: r.driver_id ? (driverName.get(r.driver_id) ?? null) : null,
    }));
  });
