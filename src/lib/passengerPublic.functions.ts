import { createServerFn } from "@tanstack/react-start";

/** PUBLIC — passenger submits a ride application without an account. */
export const submitRideRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      contact_name: string;
      contact_phone: string;
      contact_medicaid?: string;
      pickup_address: string;
      dropoff_address: string;
      requested_pickup_time?: string;
      notes?: string;
    }) => {
      if (!input.contact_name?.trim()) throw new Error("Name required");
      if (!input.contact_phone?.trim()) throw new Error("Phone required");
      if (!input.pickup_address?.trim()) throw new Error("Pickup address required");
      if (!input.dropoff_address?.trim()) throw new Error("Drop-off address required");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ride_requests").insert({
      contact_name: data.contact_name.trim(),
      contact_phone: data.contact_phone.trim(),
      contact_medicaid: data.contact_medicaid?.trim() || null,
      pickup_address: data.pickup_address.trim(),
      dropoff_address: data.dropoff_address.trim(),
      requested_pickup_time: data.requested_pickup_time || null,
      notes: data.notes?.trim() || null,
      status: "pending",
      source: "passenger_app",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** PUBLIC — active news feed for the passenger app. */
export const listPublicNews = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("news_items")
    .select("id, title, body, image_url, link_url, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** PUBLIC — active games catalog for the passenger app. */
export const listPublicGames = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id, title, url, thumbnail_url, category, description")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});
