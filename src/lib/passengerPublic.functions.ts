import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

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
    const { data: inserted, error } = await supabaseAdmin
      .from("ride_requests")
      .insert({
        contact_name: data.contact_name.trim(),
        contact_phone: data.contact_phone.trim(),
        contact_medicaid: data.contact_medicaid?.trim() || null,
        pickup_address: data.pickup_address.trim(),
        dropoff_address: data.dropoff_address.trim(),
        requested_pickup_time: data.requested_pickup_time || null,
        notes: data.notes?.trim() || null,
        status: "pending",
        source: "passenger_app",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Fan out to admins: DB feed + browser push.
    const title = "New ride request";
    const body = `${data.contact_name} — ${data.pickup_address} → ${data.dropoff_address}`;
    await supabaseAdmin.from("admin_notifications").insert({
      kind: "ride_request",
      title,
      body,
      url: "/trips",
      data: { ride_request_id: inserted?.id, phone: data.contact_phone },
    });
    try {
      const { sendPushToAdmins } = await import("@/lib/pushSend.server");
      await sendPushToAdmins({
        title,
        body,
        url: "/trips",
        tag: `ride-${inserted?.id}`,
        requireInteraction: true,
      });
    } catch (e) {
      console.warn("[ride_request] admin push failed", e);
    }

    return { ok: true };
  });

/** PUBLIC — curated news feed the admin manages. */
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

/** PUBLIC — regional news feed via Google News RSS. Defaults to Colorado Springs. */
export type RegionalNewsItem = {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
};
export const getRegionalNews = createServerFn({ method: "GET" })
  .inputValidator((input: { city?: string; region?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const city = (data.city && data.city.trim()) || "Colorado Springs";
    const region = (data.region && data.region.trim()) || "CO";
    const q = encodeURIComponent(`${city}, ${region}`);
    const url = `https://news.google.com/rss/search?q=${q}+when:2d&hl=en-US&gl=US&ceid=US:en`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 RedArt-NEMT/1.0" } });
      if (!res.ok) return { city, region, items: [] as RegionalNewsItem[], error: `feed ${res.status}` };
      const xml = await res.text();
      return { city, region, items: parseRssItems(xml, 20), error: null as string | null };
    } catch (e) {
      return { city, region, items: [] as RegionalNewsItem[], error: e instanceof Error ? e.message : "Failed" };
    }
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

/** PUBLIC — called on first visit. Creates/updates an anonymous passenger row
 * keyed by the browser-generated device_id, and records approximate location
 * from Cloudflare edge headers when available.
 */
export const trackVisitor = createServerFn({ method: "POST" })
  .inputValidator((input: { device_id: string }) => {
    if (!input.device_id || input.device_id.length < 8 || input.device_id.length > 64) {
      throw new Error("device_id required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const city = getRequestHeader("cf-ipcity") ?? null;
    const region = getRequestHeader("cf-region") ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id, ssn_last4, date_of_birth, phone, email, approx_city, approx_region")
      .eq("device_id", data.device_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("passengers")
        .update({
          last_ip: ip,
          approx_city: city ?? existing.approx_city,
          approx_region: region ?? existing.approx_region,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return {
        id: existing.id,
        city: city ?? existing.approx_city,
        region: region ?? existing.approx_region,
        has_profile: !!(existing.medicaid_id || (existing.ssn_last4 && existing.date_of_birth)),
      };
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("passengers")
      .insert({
        first_name: "Guest",
        last_name: "",
        device_id: data.device_id,
        last_ip: ip,
        approx_city: city,
        approx_region: region,
        last_seen_at: new Date().toISOString(),
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id, city, region, has_profile: false };
  });

/** PUBLIC — passenger creates or updates their profile from the app.
 * Requires either a Medicaid ID OR (last 4 of SSN + date of birth).
 */
export const upsertPassengerProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      device_id: string;
      first_name: string;
      last_name: string;
      phone?: string;
      email?: string;
      address?: string;
      medicaid_id?: string;
      ssn_last4?: string;
      date_of_birth?: string;
    }) => {
      if (!input.device_id) throw new Error("device_id required");
      if (!input.first_name?.trim() || !input.last_name?.trim()) {
        throw new Error("First and last name are required");
      }
      const hasMedicaid = !!input.medicaid_id?.trim();
      const hasAlt = !!input.ssn_last4?.trim() && !!input.date_of_birth?.trim();
      if (!hasMedicaid && !hasAlt) {
        throw new Error("Enter a Medicaid ID or last 4 of SSN plus date of birth");
      }
      if (input.ssn_last4 && !/^\d{4}$/.test(input.ssn_last4.trim())) {
        throw new Error("SSN must be exactly 4 digits");
      }
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      medicaid_id: data.medicaid_id?.trim() || null,
      ssn_last4: data.ssn_last4?.trim() || null,
      date_of_birth: data.date_of_birth || null,
      last_seen_at: new Date().toISOString(),
    };

    const { data: existing } = await supabaseAdmin
      .from("passengers")
      .select("id")
      .eq("device_id", data.device_id)
      .maybeSingle();

    let passengerId: string;
    if (existing) {
      const { error } = await supabaseAdmin
        .from("passengers")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      passengerId = existing.id;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("passengers")
        .insert({ ...payload, device_id: data.device_id, is_active: true })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      passengerId = inserted.id;
    }

    // Notify admin: new / updated passenger profile is available in the panel.
    try {
      await supabaseAdmin.from("admin_notifications").insert({
        kind: existing ? "passenger_updated" : "passenger_created",
        title: existing ? "Passenger profile updated" : "New passenger profile",
        body: `${payload.first_name} ${payload.last_name}${payload.phone ? ` · ${payload.phone}` : ""}`,
        url: "/passengers",
        data: { passenger_id: passengerId },
      });
    } catch (e) {
      console.warn("[passenger_profile] admin notification failed", e);
    }

    return { id: passengerId };
  });

/** PUBLIC — read the passenger's own profile by device_id. */
export const getMyPassengerProfile = createServerFn({ method: "GET" })
  .inputValidator((input: { device_id: string }) => {
    if (!input.device_id) throw new Error("device_id required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, phone, email, address, medicaid_id, ssn_last4, date_of_birth, approx_city, approx_region")
      .eq("device_id", data.device_id)
      .maybeSingle();
    return row;
  });

// ---------- helpers ----------
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(s: string): string {
  return decodeEntities(s).replace(/<[^>]+>/g, "").trim();
}
function parseRssItems(xml: string, limit = 15): RegionalNewsItem[] {
  const items: RegionalNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) && items.length < limit) {
    const block = m[1];
    const get = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return r ? decodeEntities(r[1]).trim() : "";
    };
    const source = /<source[^>]*>([\s\S]*?)<\/source>/.exec(block);
    items.push({
      title: stripTags(get("title")),
      link: get("link"),
      source: source ? stripTags(source[1]) : "",
      pubDate: get("pubDate"),
      description: stripTags(get("description")).slice(0, 240),
    });
  }
  return items;
}
