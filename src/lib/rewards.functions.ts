import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Settings = {
  enabled: boolean;
  rides_required: number;
  period_type: "weekly" | "monthly";
  prize_description: string;
  winners_per_period: number;
};

function periodBounds(period_type: "weekly" | "monthly", ref: Date = new Date()) {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  let start: Date;
  let end: Date;
  if (period_type === "monthly") {
    start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  } else {
    // Monday-start week
    const dow = d.getUTCDay(); // 0=Sun
    const diffToMon = (dow + 6) % 7;
    start = new Date(d);
    start.setUTCDate(d.getUTCDate() - diffToMon);
    end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
  }
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { period_start: iso(start), period_end: iso(end) };
}

async function readSettings(supabase: any): Promise<Settings> {
  const { data } = await supabase.from("rewards_settings").select("*").eq("id", true).maybeSingle();
  return (
    data ?? {
      enabled: false,
      rides_required: 15,
      period_type: "weekly",
      prize_description: "$25 Gift Card",
      winners_per_period: 1,
    }
  );
}

/** Public-ish: settings + recent winners for passenger-facing UI. */
export const getRewardsPublic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = await readSettings(context.supabase);
    const { data: winners } = await context.supabase
      .from("contest_winners")
      .select("id, period_start, period_end, prize_description, selected_at, passenger_id")
      .order("selected_at", { ascending: false })
      .limit(10);
    let named: Array<{
      id: string;
      period_start: string;
      period_end: string;
      prize_description: string;
      display_name: string;
    }> = [];
    if (winners?.length) {
      const ids = Array.from(new Set(winners.map((w: any) => w.passenger_id)));
      const { data: ps } = await context.supabase
        .from("passengers")
        .select("id, first_name, last_name")
        .in("id", ids);
      const map = new Map((ps ?? []).map((p: any) => [p.id, p]));
      named = winners.map((w: any) => {
        const p = map.get(w.passenger_id) as any;
        const fn = p?.first_name?.trim() || "Anonymous";
        const li = (p?.last_name?.trim() || " ")[0] || "";
        return {
          id: w.id,
          period_start: w.period_start,
          period_end: w.period_end,
          prize_description: w.prize_description,
          display_name: li ? `${fn} ${li}.` : fn,
        };
      });
    }
    return { settings, winners: named };
  });

/** Passenger progress + auto-qualify when threshold hit. */
export const getMyProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = await readSettings(context.supabase);
    const { period_start, period_end } = periodBounds(settings.period_type);
    const { data: passenger } = await context.supabase
      .from("passengers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passenger) {
      return { settings, period_start, period_end, ride_count: 0, entered: false, passenger: false };
    }
    // Count completed trips in period.
    const startIso = `${period_start}T00:00:00.000Z`;
    const endIso = `${period_end}T23:59:59.999Z`;
    const { count } = await context.supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("passenger_id", passenger.id)
      .eq("status", "completed")
      .gte("scheduled_pickup_time", startIso)
      .lte("scheduled_pickup_time", endIso);
    const ride_count = count ?? 0;

    let entered = false;
    if (settings.enabled && ride_count >= settings.rides_required) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("contest_entries")
        .upsert(
          {
            passenger_id: passenger.id,
            period_start,
            period_end,
            ride_count,
          },
          { onConflict: "passenger_id,period_start" },
        );
      entered = true;
    } else {
      const { data: e } = await context.supabase
        .from("contest_entries")
        .select("id")
        .eq("passenger_id", passenger.id)
        .eq("period_start", period_start)
        .maybeSingle();
      entered = !!e;
    }
    return { settings, period_start, period_end, ride_count, entered, passenger: true };
  });

/** Admin: read settings + counts. */
export const adminGetRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const settings = await readSettings(context.supabase);
    const { period_start, period_end } = periodBounds(settings.period_type);
    const { count: entryCount } = await context.supabase
      .from("contest_entries")
      .select("id", { count: "exact", head: true })
      .eq("period_start", period_start);
    const { data: winners } = await context.supabase
      .from("contest_winners")
      .select("id, passenger_id, period_start, period_end, prize_description, selected_at, delivered_at")
      .order("selected_at", { ascending: false })
      .limit(50);
    const ids = Array.from(new Set((winners ?? []).map((w: any) => w.passenger_id)));
    let passengers: any[] = [];
    if (ids.length) {
      const { data } = await context.supabase
        .from("passengers")
        .select("id, first_name, last_name, email, phone")
        .in("id", ids);
      passengers = data ?? [];
    }
    return {
      settings,
      current_period: { period_start, period_end, entrants: entryCount ?? 0 },
      winners: (winners ?? []).map((w: any) => ({
        ...w,
        passenger: passengers.find((p) => p.id === w.passenger_id) ?? null,
      })),
    };
  });

export const adminUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Settings) => {
    if (!input.prize_description?.trim()) throw new Error("Prize description required");
    if (input.rides_required < 1) throw new Error("Rides required must be > 0");
    if (input.winners_per_period < 1) throw new Error("Winners must be > 0");
    if (!["weekly", "monthly"].includes(input.period_type))
      throw new Error("Invalid period type");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("rewards_settings")
      .upsert({ id: true, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDrawWinners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const settings = await readSettings(context.supabase);
    const { period_start, period_end } = periodBounds(settings.period_type);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("contest_winners")
      .select("id")
      .eq("period_start", period_start);
    if (existing?.length) throw new Error("Winners already drawn for this period");

    const { data: entries } = await supabaseAdmin
      .from("contest_entries")
      .select("passenger_id")
      .eq("period_start", period_start);
    const pool = (entries ?? []).map((e: any) => e.passenger_id);
    if (!pool.length) throw new Error("No qualified entrants this period");

    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, settings.winners_per_period);
    const rows = picked.map((pid) => ({
      passenger_id: pid,
      period_start,
      period_end,
      prize_description: settings.prize_description,
    }));
    const { error } = await supabaseAdmin.from("contest_winners").insert(rows);
    if (error) throw new Error(error.message);
    return { drawn: rows.length };
  });

export const adminMarkDelivered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { winner_id: string; note?: string | null }) => {
    if (!input.winner_id) throw new Error("winner_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("contest_winners")
      .update({
        delivered_at: new Date().toISOString(),
        delivery_note: data.note?.trim() || null,
      })
      .eq("id", data.winner_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
