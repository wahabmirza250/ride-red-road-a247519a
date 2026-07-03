import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
};

export type DriverLocation = {
  driver_id: string;
  name: string;
  status: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  region: string | null;
};

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

function parseRssItems(xml: string, limit = 15): NewsItem[] {
  const items: NewsItem[] = [];
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

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string | null; region: string | null }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { "User-Agent": "RedArt-NEMT/1.0" } },
    );
    if (!res.ok) return { city: null, region: null };
    const j = (await res.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || null;
    const region = a.state || null;
    return { city, region };
  } catch {
    return { city: null, region: null };
  }
}

export const getDriverLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("drivers")
      .select("id, first_name, last_name, status, current_lat, current_lng")
      .not("current_lat", "is", null)
      .not("current_lng", "is", null);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const out: DriverLocation[] = await Promise.all(
      rows.map(async (d: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        status: string | null;
        current_lat: number | null;
        current_lng: number | null;
      }) => {
        const geo = d.current_lat != null && d.current_lng != null
          ? await reverseGeocode(d.current_lat, d.current_lng)
          : { city: null, region: null };
        return {
          driver_id: d.id,
          name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Driver",
          status: d.status,
          lat: d.current_lat,
          lng: d.current_lng,
          city: geo.city,
          region: geo.region,
        };
      }),
    );
    return out;
  });

export const getLocationNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { city: string; region?: string | null }) => input)
  .handler(async ({ data }) => {
    const q = encodeURIComponent(`${data.city}${data.region ? ", " + data.region : ""}`);
    const url = `https://news.google.com/rss/search?q=${q}+when:1d&hl=en-US&gl=US&ceid=US:en`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 RedArt-NEMT/1.0" } });
      if (!res.ok) return { items: [] as NewsItem[], error: `News feed returned ${res.status}` };
      const xml = await res.text();
      return { items: parseRssItems(xml, 20), error: null as string | null };
    } catch (e) {
      return { items: [] as NewsItem[], error: e instanceof Error ? e.message : "Failed to load news" };
    }
  });
