/**
 * Maps a Medicaid claim to the driver who earned it and to that driver's pay
 * amount, using the SAME pay-plan math as payroll (`src/lib/payPlans.ts`).
 * This module only reads; it never writes payouts.
 */

import { resolvePayPlan, type ResolvedPayPlan } from "@/lib/payPlans";
import { loadCompanyPaySettings } from "@/lib/payrollSources.server";

type Sb = import("@supabase/supabase-js").SupabaseClient;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type ClaimDriverPay = {
  driver_id: string | null;
  driver_name: string;
  amount: number | null;
  plan: ResolvedPayPlan | null;
};

/**
 * For each claim row, resolve `{ driver, driver pay }`.
 * Driver match order: `medicaid_trips.driver_id` (auth user) → fuzzy
 * `paper_driver_name` match against the company's drivers.
 */
export async function resolveDriverPayForClaims(
  s: Sb,
  companyId: string | null,
  trips: any[],
): Promise<Map<string, ClaimDriverPay>> {
  const out = new Map<string, ClaimDriverPay>();
  if (!trips.length) return out;

  let dq = s.from("drivers").select("id, user_id, company_id");
  if (companyId) dq = dq.eq("company_id", companyId);
  const { data: drivers } = await dq;
  const driverRows = (drivers ?? []) as any[];

  const userIds = driverRows.map((d) => d.user_id).filter(Boolean);
  const { data: profiles } = userIds.length
    ? await s.from("profiles").select("id, first_name, last_name").in("id", userIds)
    : { data: [] as any[] };
  const nameOf = new Map(
    ((profiles ?? []) as any[]).map((p) => [
      p.id as string,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    ]),
  );

  const byUser = new Map(driverRows.filter((d) => d.user_id).map((d) => [d.user_id as string, d]));
  const byName = new Map(
    driverRows
      .map((d) => [norm(nameOf.get(d.user_id) ?? ""), d] as const)
      .filter(([n]) => !!n),
  );

  // Pay plans: company defaults + per-driver overrides + legacy driver_pay.
  const ids = driverRows.map((d) => d.id as string);
  const [company, { data: plans }, { data: legacy }] = await Promise.all([
    loadCompanyPaySettings(s, companyId),
    ids.length
      ? s.from("driver_pay_plans").select("*").in("driver_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? s
          .from("driver_pay")
          .select("driver_id, hourly_rate, payout_percentage, pay_type")
          .in("driver_id", ids)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const planOf = new Map(((plans ?? []) as any[]).map((p) => [p.driver_id as string, p]));
  const legacyOf = new Map(((legacy ?? []) as any[]).map((p) => [p.driver_id as string, p]));

  const resolved = new Map<string, ResolvedPayPlan>();
  for (const id of ids) {
    const old = legacyOf.get(id);
    const fallback = old
      ? {
          plan: (old.pay_type === "commission" ? "commission" : "hourly") as any,
          hourly_rate: old.hourly_rate ?? null,
          commission_percentage: old.payout_percentage ?? null,
          per_trip_amount: null,
          commission_base: old.pay_type === "commission" ? "paid_claims" : null,
          per_trip_source: null,
        }
      : null;
    resolved.set(id, resolvePayPlan(company ?? {}, planOf.get(id) ?? fallback));
  }

  const { computeClaimTotals } = await import("@/lib/claimAmount.server");
  const totals = await computeClaimTotals(s, trips);

  for (const t of trips) {
    const driver =
      (t.driver_id ? byUser.get(t.driver_id) : null) ??
      byName.get(norm(t.paper_driver_name)) ??
      null;
    const name =
      (driver ? nameOf.get(driver.user_id) : null) || t.paper_driver_name || "Unassigned";
    const plan = driver ? (resolved.get(driver.id) ?? null) : null;
    const billed = totals.get(t.id)?.amount ?? 0;

    let amount: number | null = null;
    if (plan?.commission_percentage != null && billed > 0)
      amount = round2((billed * Number(plan.commission_percentage)) / 100);
    else if (plan?.per_trip_amount != null) amount = round2(Number(plan.per_trip_amount));

    out.set(t.id, { driver_id: driver?.id ?? null, driver_name: name, amount, plan });
  }
  return out;
}
