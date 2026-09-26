import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";

/**
 * Legacy booking endpoint, now restricted to provisioned passenger accounts.
 *
 * Existing booking clients submit a
 * phone number plus a Medicaid ID (or SSN + DOB). The guest is identified by a
 * browser-generated `device_id` that persists in localStorage, so returning to
 * the app on the same device keeps them recognized.
 *
 * Tenant safety: the company is resolved from the URL slug the guest arrived
 * through. Never fall back to a default company.
 */

type Stop = { address: string; lat: number; lng: number };

export const guestRequestRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      device_id: string;
      company_slug: string;
      contact_name?: string | null;
      contact_phone: string;
      medicaid_id?: string | null;
      ssn?: string | null;
      date_of_birth?: string | null;
      pickup_address: string;
      pickup_lat: number;
      pickup_lng: number;
      dropoff_address: string;
      dropoff_lat: number;
      dropoff_lng: number;
      notes?: string | null;
      ride_purpose?: string | null;
      stops?: Stop[] | null;
    }) => {
      if (!input.device_id || input.device_id.length < 8) throw new Error("device_id required");
      if (!input.company_slug?.trim()) {
        throw new Error("Missing company link. Please open your provider's booking link again.");
      }
      if (!input.contact_phone?.trim()) throw new Error("Phone number required");
      const medicaid_id = (input.medicaid_id ?? "").trim();
      const ssn = (input.ssn ?? "").replace(/\D/g, "");
      const dob = (input.date_of_birth ?? "").trim();
      if (!medicaid_id) {
        if (ssn.length !== 9 || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          throw new Error("Enter a Medicaid ID, or a full 9-digit SSN plus date of birth.");
        }
      }
      if (!input.pickup_address?.trim()) throw new Error("Pickup address required");
      if (!input.dropoff_address?.trim()) throw new Error("Drop-off address required");
      if (!input.pickup_lat || !input.pickup_lng || !input.dropoff_lat || !input.dropoff_lng) {
        throw new Error("Pickup and drop-off coordinates required");
      }
      const stops = Array.isArray(input.stops)
        ? input.stops
            .filter(
              (s) =>
                s && typeof s.address === "string" && s.address.trim() &&
                typeof s.lat === "number" && typeof s.lng === "number",
            )
            .map((s) => ({ address: s.address.trim(), lat: s.lat, lng: s.lng }))
        : [];
      return { ...input, medicaid_id, ssn, date_of_birth: dob, stops };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCompanyBySlug } = await import("@/lib/company.server");

    const { assertCompanyActive } = await import("@/lib/company.server");
    const mine = await assertCompanyActive(context.userId);
    if (mine.url_slug !== data.company_slug.trim().toLowerCase()) throw new Error("Use your own company code.");
    const company = await getCompanyBySlug(mine.url_slug);
    if (!company) throw new Error("Unknown provider link.");
    if (company.status !== "active") {
      throw new Error(`${company.name} is not accepting rides right now.`);
    }

    const name = (data.contact_name ?? "").trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] || "Guest";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    const phone = data.contact_phone.trim();

    // Only a passenger record provisioned for the authenticated account may be used.
    const { data: existing } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id")
      .eq("user_id", context.userId)
      .eq("company_id", company.id)
      .maybeSingle();

    let passengerId: string;
    if (existing) {
      passengerId = existing.id;
      await supabaseAdmin
        .from("passengers")
        .update({
          first_name: existing.first_name && existing.first_name !== "Guest" ? existing.first_name : first,
          last_name: existing.last_name || last,
          phone,
          company_id: company.id,
          date_of_birth: data.date_of_birth || null,
          ...(data.medicaid_id ? { medicaid_id: data.medicaid_id } : {}),
          last_seen_at: new Date().toISOString(),
          is_active: true,
        })
        .eq("id", passengerId);
    } else {
      throw new Error("Ask your administrator to create your passenger profile.");
    }

    // Encrypt the full SSN into Vault when that is the identity path used.
    if (!data.medicaid_id && data.ssn.length === 9) {
      const { error: ssnErr } = await supabaseAdmin.rpc("set_passenger_ssn", {
        _passenger_id: passengerId,
        _ssn: data.ssn,
      });
      if (ssnErr) throw new Error(ssnErr.message);
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        company_id: company.id,
        passenger_id: context.userId,
        pickup_address: data.pickup_address.trim(),
        pickup_lat: data.pickup_lat,
        pickup_lng: data.pickup_lng,
        dropoff_address: data.dropoff_address.trim(),
        dropoff_lat: data.dropoff_lat,
        dropoff_lng: data.dropoff_lng,
        notes: data.notes?.trim() || null,
        contact_name: name || `${first} ${last}`.trim(),
        contact_phone: phone,
        contact_medicaid: data.medicaid_id || null,
        ride_purpose: data.ride_purpose ?? null,
        vehicle_type: data.notes?.match(/\[VEHICLE:([a-zA-Z_]+)\]/)?.[1]?.toLowerCase() ?? null,
        stops: data.stops,
        status: "pending",
        source: "passenger_app_guest",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create ride request");

    const { notifyDispatchers } = await import("@/lib/notifyStaff.server");
    await notifyDispatchers({
      kind: "ride_request",
      title: "New ride request",
      body: `${name || `${first} ${last}`.trim()} — ${data.pickup_address} → ${data.dropoff_address}`,
      url: "/dispatch",
      companyId: company.id,
      data: { ride_request_id: inserted.id, phone },
      smsSuffix: `Call back: ${phone}`,
    });

    const { dispatchRideInternal } = await import("@/lib/dispatchEngine.server");
    const dispatch = await dispatchRideInternal({ request_id: inserted.id });
    return { request_id: inserted.id, ...dispatch };

  });

/**
 * PUBLIC — tracking view for a ride request. Same trust model as
 * `cancelRideRequest`: possession of the request UUID (the passenger's own
 * tracking link) grants read access to that ride only. Deliberately narrow —
 * no Medicaid ID, no other passengers' data.
 */
export const getGuestRideView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("request_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireRideAccess } = await import('./rideAccess.server');
    await requireRideAccess(context.userId, data.request_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("ride_requests")
      .select(
        "id,status,driver_id,trip_id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,offer_expires_at,created_at,contact_phone",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (!req) return null;

    type GuestDriver = {
      id: string;
      user_id: string;
      current_lat: number | null;
      current_lng: number | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_year: number | null;
      vehicle_color: string | null;
      vehicle_plate: string | null;
      vehicle_photo_path: string | null;
      photo_url: string | null;
      profile: {
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        avatar_url: string | null;
      } | null;
    };
    let driver: GuestDriver | null = null;
    if (req.driver_id) {
      const { data: d } = await supabaseAdmin
        .from("drivers")
        .select(
          "id, user_id, current_lat, current_lng, vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_plate, vehicle_photo_path, photo_url",
        )
        .eq("id", req.driver_id)
        .maybeSingle();
      if (d) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("first_name, last_name, phone, avatar_url")
          .eq("id", d.user_id)
          .maybeSingle();
        driver = { ...d, profile: prof ?? null };
      }
    }
    return { request: req, driver };
  });

/** PUBLIC — a guest's own recent rides on this device. */
export const listGuestRides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { device_id: string }) => {
    if (!input?.device_id) throw new Error("device_id required");
    return input;
  })
  .handler(async ({ context }) => {
    const { assertCompanyActive } = await import('./company.server');
    const company = await assertCompanyActive(context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pax } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, phone")
      .eq("user_id", context.userId).eq("company_id", company.id)
      .maybeSingle();
    if (!pax) return { first_name: null, rides: [] };
    const { data: rides } = await supabaseAdmin
      .from("ride_requests")
      .select("id, status, dropoff_address, created_at, trip_id")
      .eq("passenger_id", context.userId).eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(10);
    return { first_name: pax.first_name, rides: rides ?? [] };
  });

/** PUBLIC — dispatch phone number shown to guests on the tracking screen. */
export const getPublicDispatchPhone = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertCompanyActive } = await import('./company.server');
    const company = await assertCompanyActive(context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data, error } = await supabaseAdmin.from('app_settings').select('value')
      .eq('key', `company:${company.id}:support_phone`).maybeSingle();
    if (error) throw new Error('Unable to load company support details.');
    return { phone: data?.value ?? null };
  });
