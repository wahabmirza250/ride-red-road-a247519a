/**
 * SAFE DRIVER MERGE (server-only).
 *
 * Nothing is deleted. A merge reassigns every reference from the duplicate row
 * to the canonical driver row and then marks the duplicate offline, so all
 * history, payouts and compliance documents stay readable.
 *
 * Two classes of reference exist in this schema:
 *   - tables keyed by `drivers.id` (trips, shifts, payroll, expenses, ...)
 *   - tables keyed by the driver's AUTH USER id (`medicaid_trips.driver_id`)
 * Both are handled, and the merge refuses to run when the two rows do not share
 * a company or when the caller has not explicitly approved it.
 */
import { canMergePair, type DriverIdentity } from "@/lib/driverDuplicates";

type Sb = any;

/** Tables whose `driver_id` holds a `drivers.id`. */
export const DRIVER_ROW_TABLES = [
  "trips",
  "driver_shifts",
  
  "driver_payouts",
  "driver_payout_items",
  "driver_claim_payouts",
  "driver_hour_clearings",
  "driver_insurance_docs",
  "driver_trip_drafts",
  "gas_receipts",
  "fuel_logs",
  "vehicle_expenses",
  "inspections",
  "incidents",
  "payroll_items",
  "manual_claim_records",
  "routes",
  "shifts",
  "ride_requests",
  "dispatch_events",
] as const;

/** Tables whose `driver_id` holds the driver's auth user id. */
export const DRIVER_USER_TABLES = ["medicaid_trips", "messages"] as const;

/**
 * Pay-setting tables keyed one-row-per-driver (`driver_id` is the primary
 * key). A blanket re-parent would collide, so the duplicate's saved rate is
 * only adopted when the kept driver has no rate of its own — an existing,
 * valid percentage is never overwritten.
 */
export const DRIVER_PAY_TABLES = ["driver_pay_plans", "driver_pay"] as const;

export type MergePlan = {
  keeper: DriverIdentity;
  duplicate: DriverIdentity;
  counts: Record<string, number>;
  total: number;
  blocked: string | null;
};

async function countRows(s: Sb, table: string, column: string, value: string): Promise<number> {
  try {
    const { count } = await s
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, value);
    return Number(count ?? 0);
  } catch {
    return 0;
  }
}

async function loadDriver(s: Sb, id: string): Promise<DriverIdentity | null> {
  const { data } = await s
    .from("drivers")
    .select("id, user_id, company_id, created_at, total_trips")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  let profile: any = null;
  if (data.user_id) {
    const { data: p } = await s
      .from("profiles")
      .select("first_name, last_name, email, phone")
      .eq("id", data.user_id)
      .maybeSingle();
    profile = p ?? null;
  }
  return {
    id: data.id,
    user_id: data.user_id ?? null,
    company_id: data.company_id ?? null,
    created_at: data.created_at ?? null,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    activity: Number(data.total_trips ?? 0),
  };
}

/** READ-ONLY preview of exactly what a merge would move. */
export async function previewDriverMerge(
  s: Sb,
  args: { keeperId: string; duplicateId: string },
): Promise<MergePlan> {
  const [keeper, duplicate] = await Promise.all([
    loadDriver(s, args.keeperId),
    loadDriver(s, args.duplicateId),
  ]);
  if (!keeper || !duplicate) throw new Error("Driver record not found");

  const allowed = canMergePair(keeper, duplicate);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const t of DRIVER_ROW_TABLES) {
    const n = await countRows(s, t, "driver_id", duplicate.id);
    if (n > 0) {
      counts[t] = n;
      total += n;
    }
  }
  if (duplicate.user_id) {
    for (const t of DRIVER_USER_TABLES) {
      const n = await countRows(s, t, "driver_id", duplicate.user_id);
      if (n > 0) {
        counts[t] = n;
        total += n;
      }
    }
  }
  for (const t of DRIVER_PAY_TABLES) {
    const n = await countRows(s, t, "driver_id", duplicate.id);
    if (n > 0) counts[t] = n; // adopted only if the keeper has no saved rate
  }
  return {
    keeper,
    duplicate,
    counts,
    total,
    blocked: allowed.ok ? null : allowed.reason,
  };
}

export type MergeResult = {
  keeperId: string;
  duplicateId: string;
  moved: Record<string, number>;
  total: number;
};

/**
 * Execute an approved merge. Caller MUST have verified admin rights and passed
 * an explicit approval; this function refuses anything the preview blocks.
 */
export async function mergeDriverRecords(
  s: Sb,
  args: { keeperId: string; duplicateId: string; actorId: string | null; note?: string | null },
): Promise<MergeResult> {
  const plan = await previewDriverMerge(s, {
    keeperId: args.keeperId,
    duplicateId: args.duplicateId,
  });
  if (plan.blocked) throw new Error(plan.blocked);

  const moved: Record<string, number> = {};
  let total = 0;

  for (const t of DRIVER_ROW_TABLES) {
    if (!plan.counts[t]) continue;
    const { data, error } = await s
      .from(t)
      .update({ driver_id: plan.keeper.id })
      .eq("driver_id", plan.duplicate.id)
      .select("id");
    if (error) throw new Error(`Could not move ${t}: ${error.message}`);
    moved[t] = (data ?? []).length;
    total += moved[t];
  }

  if (plan.duplicate.user_id && plan.keeper.user_id) {
    for (const t of DRIVER_USER_TABLES) {
      if (!plan.counts[t]) continue;
      const { data, error } = await s
        .from(t)
        .update({ driver_id: plan.keeper.user_id })
        .eq("driver_id", plan.duplicate.user_id)
        .select("id");
      if (error) throw new Error(`Could not move ${t}: ${error.message}`);
      moved[t] = (data ?? []).length;
      total += moved[t];
    }
  }

  // Pay settings: the kept driver's own saved rate always wins. The
  // duplicate's rate is only carried over when the keeper has none, so a merge
  // can never wipe or silently change a configured percentage.
  for (const t of DRIVER_PAY_TABLES) {
    if (!plan.counts[t]) continue;
    const { data: existing } = await s
      .from(t)
      .select("driver_id")
      .eq("driver_id", plan.keeper.id)
      .maybeSingle();
    if (existing) continue;
    const { data, error } = await s
      .from(t)
      .update({ driver_id: plan.keeper.id })
      .eq("driver_id", plan.duplicate.id)
      .select("driver_id");
    if (error) throw new Error(`Could not move ${t}: ${error.message}`);
    moved[t] = (data ?? []).length;
    total += moved[t];
  }

  // The duplicate row is retired, never deleted: audit history keeps pointing
  // at a real record, and a mistake stays reversible. `merged_into` is what
  // payroll and the drivers list use to treat the pair as one person.
  await s
    .from("drivers")
    .update({
      status: "offline",
      unit_number: null,
      merged_into: plan.keeper.id,
      merged_at: new Date().toISOString(),
    })
    .eq("id", plan.duplicate.id);

  // Audit trail: payroll_audit_log allows company-scoped, item-less entries.
  await s.from("payroll_audit_log").insert({
    company_id: plan.keeper.company_id,
    payroll_item_id: null,
    action: "driver_merged",
    actor_id: args.actorId,
    notes:
      `Merged driver ${plan.duplicate.id} into ${plan.keeper.id}. ${args.note ?? ""}`.trim(),
    data: { keeper_id: plan.keeper.id, duplicate_id: plan.duplicate.id, moved, total },
  });

  return { keeperId: plan.keeper.id, duplicateId: plan.duplicate.id, moved, total };
}
