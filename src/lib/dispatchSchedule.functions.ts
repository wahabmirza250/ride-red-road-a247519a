import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function activeCompanyId(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not identify your company");
  if (!data?.company_id) throw new Error("Your account is not connected to a company");
  return data.company_id;
}

/** Passenger picker for the dispatch "Add ride" form (staff only). */
export const dispatchListPassengers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const companyId = await activeCompanyId(context.userId);
    const { data, error } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, phone")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("first_name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => ({
      id: p.id,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Passenger",
      medicaid_id: p.medicaid_id ?? "",
      phone: p.phone ?? "",
    }));
  });

type CreatePassengerInput = {
  full_name: string;
  medicaid_id: string;
  date_of_birth?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

/** Create (or safely reuse) a passenger inside the signed-in company. */
export const dispatchCreatePassenger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePassengerInput) => {
    if (!input?.full_name?.trim()) throw new Error("Passenger name is required");
    if (!input?.medicaid_id?.trim()) throw new Error("Medicaid ID is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireStaff, logDispatchEvent } = await import("@/lib/staffGuard.server");
    const { isAdmin } = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const companyId = await activeCompanyId(context.userId);
    const medicaidId = data.medicaid_id.trim().toUpperCase();

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, phone")
      .eq("company_id", companyId)
      .ilike("medicaid_id", medicaidId)
      .maybeSingle();
    if (lookupError) throw new Error("Could not check this Medicaid ID");
    if (existing) {
      return {
        id: existing.id,
        name: `${existing.first_name ?? ""} ${existing.last_name ?? ""}`.trim() || "Passenger",
        medicaid_id: existing.medicaid_id ?? medicaidId,
        phone: existing.phone ?? "",
        reused: true,
      };
    }

    const parts = data.full_name.trim().split(/\s+/);
    const firstName = parts.shift()!;
    const lastName = parts.join(" ");

    const { data: passenger, error } = await supabaseAdmin
      .from("passengers")
      .insert({
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        medicaid_id: medicaidId,
        date_of_birth: data.date_of_birth || null,
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        is_active: true,
      })
      .select("id, first_name, last_name, medicaid_id, phone")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("This Medicaid ID already exists for your company");
      throw new Error("Could not add passenger");
    }

    await logDispatchEvent({
      kind: "passenger_created",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      summary: `Added passenger ${data.full_name.trim()} from Add ride`,
      data: { passenger_id: passenger.id, company_id: companyId },
    });
    return {
      id: passenger.id,
      name: `${passenger.first_name ?? ""} ${passenger.last_name ?? ""}`.trim() || "Passenger",
      medicaid_id: passenger.medicaid_id ?? medicaidId,
      phone: passenger.phone ?? "",
      reused: false,
    };
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
    const companyId = await activeCompanyId(context.userId);

    const { data: passenger } = await supabaseAdmin
      .from("passengers").select("id, first_name, last_name, phone, medicaid_id").eq("id", data.passenger_id)
      .eq("company_id", companyId).maybeSingle();
    if (!passenger) throw new Error("Selected passenger does not belong to this company");

    const driverId = data.driver_id || null;
    if (driverId) {
      const { data: driver } = await supabaseAdmin
        .from("drivers").select("id").eq("id", driverId)
        .eq("company_id", companyId).maybeSingle();
      if (!driver) throw new Error("Selected driver does not belong to this company");
    }

    const iso = new Date(data.scheduled_pickup_time).toISOString();
    const passengerName =
      `${passenger.first_name ?? ""} ${passenger.last_name ?? ""}`.trim() || "Passenger";
    // The dispatch board is powered by ride_requests. Keep the request pending
    // until the assigned driver accepts it; acceptRideOffer creates the trip.
    const { data: request, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        company_id: companyId,
        passenger_id: passenger.id,
        driver_id: driverId,
        trip_id: null,
        status: "pending",
        source: "dispatcher",
        contact_name: passengerName,
        contact_phone: passenger.phone ?? null,
        contact_medicaid: passenger.medicaid_id ?? null,
        pickup_address: data.pickup_address.trim(),
        dropoff_address: data.dropoff_address.trim(),
        pickup_lat: data.pickup_lat ?? null,
        pickup_lng: data.pickup_lng ?? null,
        dropoff_lat: data.dropoff_lat ?? null,
        dropoff_lng: data.dropoff_lng ?? null,
        requested_pickup_time: iso,
        offer_expires_at: null,
        notes: data.notes?.trim() || null,
      })
      .select("id, requested_pickup_time, status, driver_id")
      .single();
    if (error) throw new Error(error.message);

    await logDispatchEvent({
      kind: "ride_scheduled",
      actor_id: context.userId,
      actor_role: isAdmin ? "admin" : "dispatch",
      request_id: request.id,
      driver_id: driverId,
      summary: `Scheduled ride ${data.pickup_address} → ${data.dropoff_address} for ${new Date(iso).toLocaleString()}`,
      data: { scheduled_pickup_time: iso, company_id: companyId },
    });
    return request;
  });
