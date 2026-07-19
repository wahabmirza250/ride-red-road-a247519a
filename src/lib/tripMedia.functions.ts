import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Record trip media whose file the client already uploaded to `trip-media`
 *  bucket under `<user_id>/<trip>/<filename>`. */
export const recordTripMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { trip_id: string; kind: string; storage_path: string }) => {
      if (!input.trip_id || !input.storage_path || !input.kind) throw new Error("Missing fields");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers").select("id").eq("user_id", context.userId).maybeSingle();
    const { data: trip } = await supabaseAdmin
      .from("trips").select("driver_id").eq("id", data.trip_id).maybeSingle();
    if (!trip) throw new Error("Trip not found");
    if (!driver || trip.driver_id !== driver.id) {
      const { data: adminRow } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
      if (!adminRow) throw new Error("Not authorized");
    }
    const { data: row, error } = await supabaseAdmin
      .from("trip_media")
      .insert({ trip_id: data.trip_id, kind: data.kind, storage_path: data.storage_path })
      .select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getTripProofBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { trip_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: adminRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    const { data: driver } = await supabaseAdmin
      .from("drivers").select("id").eq("user_id", context.userId).maybeSingle();
    const { data: trip, error } = await supabaseAdmin
      .from("trips")
      .select("*")
      .eq("id", data.trip_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!trip) throw new Error("Trip not found");
    if (!adminRow && (!driver || trip.driver_id !== driver.id)) throw new Error("Not authorized");

    const { data: stops } = await supabaseAdmin
      .from("trip_stops").select("*").eq("trip_id", data.trip_id).order("sequence");
    const { data: media } = await supabaseAdmin
      .from("trip_media").select("*").eq("trip_id", data.trip_id).order("captured_at");
    const { data: passengers } = await supabaseAdmin
      .from("ride_passengers").select("*").eq("trip_id", data.trip_id);

    // Signed URLs for evidence bundle
    const signedFor = async (bucket: string, path: string | null) => {
      if (!path) return null;
      const { data: s } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 60);
      return s?.signedUrl ?? null;
    };

    const [pickupOdoUrl, dropoffOdoUrl, signatureUrl] = await Promise.all([
      signedFor("odometers", trip.odometer_start_photo),
      signedFor("odometers", trip.odometer_end_photo),
      signedFor("signatures", trip.signature_url),
    ]);

    const mediaWithUrls = await Promise.all(
      (media ?? []).map(async (m) => ({ ...m, url: await signedFor("trip-media", m.storage_path) })),
    );

    return {
      trip,
      stops: stops ?? [],
      media: mediaWithUrls,
      passengers: passengers ?? [],
      urls: { pickupOdometer: pickupOdoUrl, dropoffOdometer: dropoffOdoUrl, signature: signatureUrl },
    };
  });
