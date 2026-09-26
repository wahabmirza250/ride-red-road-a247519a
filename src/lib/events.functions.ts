import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(userId: string) {
  const { requireStaff } = await import('./staffGuard.server');
  await requireStaff(userId, ['admin']);
  const { assertCompanyActive } = await import('./company.server');
  return assertCompanyActive(userId);
}

export type EventInput = {
  id?: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at?: string | null;
  location_address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  image_url?: string | null;
  is_active?: boolean;
  notify?: boolean;
};

export const upsertEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EventInput) => {
    if (!input.title?.trim()) throw new Error("Title required");
    if (!input.starts_at || !Number.isFinite(Date.parse(input.starts_at))) throw new Error("Valid start time required");
    if (input.ends_at && (!Number.isFinite(Date.parse(input.ends_at)) || Date.parse(input.ends_at) <= Date.parse(input.starts_at))) throw new Error("End time must be after the start time");
    return input;
  })
  .handler(async ({ data, context }) => {
    const company = await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      company_id: company.id,
      title: data.title.trim(),
      description: data.description?.trim() ?? "",
      starts_at: data.starts_at,
      ends_at: data.ends_at || null,
      location_address: data.location_address?.trim() || null,
      location_lat: data.location_lat ?? null,
      location_lng: data.location_lng ?? null,
      image_url: data.image_url?.trim() || null,
      is_active: data.is_active ?? true,
      created_by: context.userId,
    };

    let row: { id: string; title: string };
    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("events")
        .update(payload)
        .eq("id", data.id)
        .eq("company_id", company.id)
        .select("id, title")
        .single();
      if (error) throw new Error(error.message);
      row = updated;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("events")
        .insert(payload)
        .select("id, title")
        .single();
      if (error) throw new Error(error.message);
      row = inserted;
    }

    if (data.notify && (data.is_active ?? true)) {
      try {
        const { sendPushToAllPassengers } = await import("@/lib/pushSend.server");
        const when = new Date(data.starts_at).toLocaleString();
        await sendPushToAllPassengers(company.id, {
          title: row.title,
          body: `${when}${data.location_address ? " • " + data.location_address : ""} — tap to book a ride`,
          url: `/${company.url_slug}/passenger/events`,
          tag: `event-${row.id}`,
          requireInteraction: true,
        });
      } catch (e) {
        console.warn("[events] push notify failed", e);
      }
    }

    return { ok: true, id: row.id };
  });

export const listEventsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const company = await ensureAdmin(context.userId);
    const { data, error } = await context.supabase
      .from("events")
      .select("*")
      .eq("company_id", company.id)
      .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const company = await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("events").delete().eq("id", data.id).eq("company_id", company.id).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Active events for the signed-in account’s company. */
export const listActiveEvents = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { assertCompanyActive } = await import("./company.server");
  const company = await assertCompanyActive(context.userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("id, title, description, starts_at, ends_at, location_address, location_lat, location_lng, image_url")
    .eq("is_active", true)
    .eq("company_id", company.id)
    .order("starts_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});
