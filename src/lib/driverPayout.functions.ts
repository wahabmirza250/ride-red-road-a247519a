import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Commission-style driver pay: a driver earns a percentage of the claims that
 * the STATE actually PAID (billing_records.status = 'paid', the manual status
 * the biller records in Claims History). Hour-based payroll lives in
 * payroll.functions.ts and is a separate thing.
 *
 * Every paid claim can belong to at most one payout — enforced by a unique
 * constraint on driver_claim_payout_items.trip_id — so the same bill can never
 * be paid to a driver twice, even if two billers race.
 */

export type PayoutClaimRow = {
  trip_id: string;
  trip_date: string | null;
  member_name: string | null;
  claim_id: string | null;
  amount: number;
  source: "app" | "paper";
  already_paid_out: { payout_id: string; paid_at: string } | null;
};

export type PayoutDriver = {
  driver_id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  payout_percentage: number | null;
  pay_type: "per_hour" | "commission";
};

export type PayoutHistoryRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  period_start: string;
  period_end: string;
  total_billed: number;
  percentage_used: number;
  /** Percentage-derived amount, before any manual extra. */
  base_amount: number;
  /** Manual bonus/adjustment added on top of the calculated amount. */
  extra_amount: number;
  extra_note: string | null;
  payout_amount: number;
  claim_count: number;
  notes: string | null;
  paid_at: string;
  paid_by_name: string | null;
};

type Sb = import("@supabase/supabase-js").SupabaseClient;

async function assertBillingOrAdmin(supabase: Sb, userId: string) {
  const [{ data: isAdmin }, { data: isBilling }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
  ]);
  if (!isAdmin && !isBilling) throw new Error("Forbidden: billing or admin only");
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Drivers of the caller's company, with their stored default percentage. */
export const listPayoutDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PayoutDriver[]> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    const { data: drivers, error } = await supabase
      .from("drivers")
      .select("id, user_id")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (drivers ?? []) as { id: string; user_id: string | null }[];
    if (!rows.length) return [];

    const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
    const [{ data: profiles }, { data: pay }] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id, first_name, last_name, phone").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("driver_pay").select("driver_id, payout_percentage, pay_type"),
    ]);

    const byUser = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const pctByDriver = new Map(
      (pay ?? []).map((p: any) => [p.driver_id, p.payout_percentage]),
    );
    const payTypeByDriver = new Map(
      (pay ?? []).map((p: any) => [p.driver_id, p.pay_type ?? "per_hour"]),
    );

    return rows.map((d) => {
      const p = d.user_id ? byUser.get(d.user_id) : null;
      const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
      const pct = pctByDriver.get(d.id);
      return {
        driver_id: d.id,
        user_id: d.user_id,
        name: name || p?.email || "Unnamed driver",
        phone: p?.phone || null,
        payout_percentage: pct == null ? null : Number(pct),
        pay_type: (payTypeByDriver.get(d.id) ?? "per_hour") as "per_hour" | "commission",
      };
    });
  });

/** Set the driver's DEFAULT payout percentage (editable at any time). */
export const setDriverPayoutPercentage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        driver_id: z.string().uuid(),
        payout_percentage: z.number().min(0).max(100).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { error } = await supabase
      .from("driver_pay")
      .upsert(
        { driver_id: data.driver_id, payout_percentage: data.payout_percentage },
        { onConflict: "driver_id" },
      );
    if (error) throw new Error(error.message);

    // KEEP BOTH STORES IN STEP. Payroll resolves a driver's plan from
    // `driver_pay_plans`; if an override row already exists for this driver it
    // must not keep shadowing the percentage the admin just saved here. Only an
    // EXISTING override row is touched — no plan is invented for a driver who
    // has none, so nothing is ever guessed.
    const { data: existing } = await supabase
      .from("driver_pay_plans")
      .select("driver_id")
      .eq("driver_id", data.driver_id)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("driver_pay_plans")
        .update({ commission_percentage: data.payout_percentage })
        .eq("driver_id", data.driver_id);
    }
    return { ok: true, payout_percentage: data.payout_percentage };
  });

/**
 * Every PAID claim for a driver inside a date range.
 *
 * A claim belongs to a driver when the trip was created by that driver's app
 * account, OR when a paper bill names them (paper bills carry the driver's
 * name as free text, not a user id).
 */
async function collectPaidClaims(
  supabase: Sb,
  driverId: string,
  from: string,
  to: string,
): Promise<{ claims: PayoutClaimRow[]; driverName: string }> {
  const { data: driver, error: dErr } = await supabase
    .from("drivers")
    .select("id, user_id")
    .eq("id", driverId)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!driver) throw new Error("Driver not found");

  let driverName = "";
  if (driver.user_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", driver.user_id)
      .maybeSingle();
    driverName = `${prof?.first_name ?? ""} ${prof?.last_name ?? ""}`.trim();
  }

  const { data: trips, error } = await supabase
    .from("medicaid_trips")
    .select(
      "id, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, driver_id, paper_driver_name, robot_captured_claim, robot_confirmation_number, submitted_confirmation, portal_confirmation, riders(full_name), medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
    )
    .gte("pickup_at", `${from}T00:00:00`)
    .lte("pickup_at", `${to}T23:59:59.999`)
    .limit(1000);
  if (error) throw new Error(error.message);

  const wanted = (trips ?? []).filter((t: any) => {
    if (driver.user_id && t.driver_id === driver.user_id) return true;
    return !!driverName && norm(t.paper_driver_name) === norm(driverName);
  });
  if (!wanted.length) return { claims: [], driverName };

  const ids = wanted.map((t: any) => t.id as string);
  const [{ data: records }, { data: items }] = await Promise.all([
    supabase.from("billing_records").select("trip_id, status").in("trip_id", ids),
    supabase
      .from("driver_claim_payout_items")
      .select("trip_id, payout_id, driver_claim_payouts(paid_at)")
      .in("trip_id", ids),
  ]);

  const paidTrips = new Set(
    ((records ?? []) as any[]).filter((r) => r.status === "paid").map((r) => r.trip_id),
  );
  const lockedBy = new Map(
    ((items ?? []) as any[]).map((i) => [
      i.trip_id,
      { payout_id: i.payout_id as string, paid_at: i.driver_claim_payouts?.paid_at ?? "" },
    ]),
  );

  const paidRows = wanted.filter((t: any) => paidTrips.has(t.id));
  const { computeClaimTotals } = await import("@/lib/claimAmount.server");
  const totals = await computeClaimTotals(supabase, paidRows);

  const claims: PayoutClaimRow[] = paidRows
    .map((t: any) => ({
      trip_id: t.id as string,
      trip_date: t.pickup_at ?? null,
      member_name: t.riders?.full_name ?? null,
      claim_id:
        t.robot_confirmation_number ?? t.submitted_confirmation ?? t.portal_confirmation ?? null,
      amount: round2(totals.get(t.id)?.amount ?? 0),
      source: t.paper_driver_name ? ("paper" as const) : ("app" as const),
      already_paid_out: lockedBy.get(t.id) ?? null,
    }))
    .sort((a, b) => (a.trip_date ?? "").localeCompare(b.trip_date ?? ""));

  return { claims, driverName };
}

const rangeInput = z.object({
  driver_id: z.string().uuid(),
  from: z.string().min(10),
  to: z.string().min(10),
});

/** Preview: paid claims in range, overlapping payouts, and the calculated payout. */
export const getDriverPayoutPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    const { claims, driverName } = await collectPaidClaims(
      supabase,
      data.driver_id,
      data.from,
      data.to,
    );

    const { data: pay } = await supabase
      .from("driver_pay")
      .select("payout_percentage")
      .eq("driver_id", data.driver_id)
      .maybeSingle();
    const defaultPct = pay?.payout_percentage == null ? null : Number(pay.payout_percentage);

    // Any previously confirmed payout whose window touches this one.
    const { data: overlaps } = await supabase
      .from("driver_claim_payouts")
      .select("id, period_start, period_end, payout_amount, paid_at")
      .eq("driver_id", data.driver_id)
      .lte("period_start", data.to)
      .gte("period_end", data.from)
      .order("paid_at", { ascending: false });

    const payable = claims.filter((c) => !c.already_paid_out);
    const totalPaidClaims = round2(claims.reduce((s, c) => s + c.amount, 0));
    const totalPayable = round2(payable.reduce((s, c) => s + c.amount, 0));

    return {
      driver_name: driverName,
      claims,
      total_all: totalPaidClaims,
      total_payable: totalPayable,
      payable_count: payable.length,
      default_percentage: defaultPct,
      overlaps: ((overlaps ?? []) as any[]).map((o) => ({
        id: o.id as string,
        period_start: o.period_start as string,
        period_end: o.period_end as string,
        payout_amount: Number(o.payout_amount ?? 0),
        paid_at: o.paid_at as string,
      })),
    };
  });

/** Confirm the payout: recomputes server-side and locks every included bill. */
export const confirmDriverPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    rangeInput
      .extend({
        percentage: z.number().min(0).max(100),
        notes: z.string().max(500).optional(),
        // Optional bonus / adjustment added on top of the calculated payout.
        extra_amount: z.number().min(-100000).max(100000).optional(),
        extra_note: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    // Never trust client totals — recompute from the database.
    const { claims } = await collectPaidClaims(supabase, data.driver_id, data.from, data.to);
    const payable = claims.filter((c) => !c.already_paid_out);
    if (!payable.length) {
      throw new Error("No unpaid, state-paid claims in this date range.");
    }

    const totalBilled = round2(payable.reduce((s, c) => s + c.amount, 0));
    const baseAmount = round2((totalBilled * data.percentage) / 100);
    const extraAmount = round2(data.extra_amount ?? 0);
    const payoutAmount = round2(baseAmount + extraAmount);
    if (payoutAmount < 0) throw new Error("The extra amount cannot make the payout negative.");

    const { data: payout, error } = await supabase
      .from("driver_claim_payouts")
      .insert({
        driver_id: data.driver_id,
        period_start: data.from,
        period_end: data.to,
        total_billed: totalBilled,
        percentage_used: data.percentage,
        payout_amount: payoutAmount,
        extra_amount: extraAmount,
        extra_note: data.extra_note?.trim() || null,
        claim_count: payable.length,
        notes: data.notes ?? null,
        paid_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: itemErr } = await supabase.from("driver_claim_payout_items").insert(
      payable.map((c) => ({
        payout_id: payout.id,
        trip_id: c.trip_id,
        amount: c.amount,
        trip_date: c.trip_date ? c.trip_date.slice(0, 10) : null,
      })),
    );
    if (itemErr) {
      // A racing payout already locked one of these bills — roll back entirely.
      await supabase.from("driver_claim_payouts").delete().eq("id", payout.id);
      throw new Error(
        "Some of these bills were just paid out by someone else. Reload and try again.",
      );
    }

    return {
      id: payout.id as string,
      total_billed: totalBilled,
      base_amount: baseAmount,
      extra_amount: extraAmount,
      payout_amount: payoutAmount,
      claim_count: payable.length,
    };
  });

/** Payout history, newest first. */
export const listDriverPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ driver_id: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PayoutHistoryRow[]> => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);

    let q = supabase
      .from("driver_claim_payouts")
      .select(
        "id, driver_id, period_start, period_end, total_billed, percentage_used, payout_amount, extra_amount, extra_note, claim_count, notes, paid_at, paid_by",
      )
      .order("paid_at", { ascending: false })
      .limit(200);
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    if (!list.length) return [];

    const { data: drivers } = await supabase
      .from("drivers")
      .select("id, user_id")
      .in("id", Array.from(new Set(list.map((r) => r.driver_id))));
    const userIds = [
      ...((drivers ?? []) as any[]).map((d) => d.user_id),
      ...list.map((r) => r.paid_by),
    ].filter(Boolean) as string[];
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, first_name, last_name").in("id", userIds)
      : { data: [] as any[] };
    const nameOf = (id: string | null) => {
      const p = (profiles ?? []).find((x: any) => x.id === id);
      return p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : null;
    };
    const driverUser = new Map(((drivers ?? []) as any[]).map((d) => [d.id, d.user_id]));

    return list.map((r) => ({
      id: r.id,
      driver_id: r.driver_id,
      driver_name: nameOf(driverUser.get(r.driver_id) ?? null) || "Driver",
      period_start: r.period_start,
      period_end: r.period_end,
      total_billed: Number(r.total_billed ?? 0),
      percentage_used: Number(r.percentage_used ?? 0),
      base_amount: round2(Number(r.payout_amount ?? 0) - Number(r.extra_amount ?? 0)),
      extra_amount: Number(r.extra_amount ?? 0),
      extra_note: r.extra_note ?? null,
      payout_amount: Number(r.payout_amount ?? 0),
      claim_count: Number(r.claim_count ?? 0),
      notes: r.notes ?? null,
      paid_at: r.paid_at,
      paid_by_name: nameOf(r.paid_by),
    }));
  });

/** Undo a payout — releases its bills so they can be paid in a later period. */
export const deleteDriverPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { error } = await supabase.from("driver_claim_payouts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
