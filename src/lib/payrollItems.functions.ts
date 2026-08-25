import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MANUAL_CATEGORIES,
  PAYROLL_STATUSES,
  round2,
  validateManualItem,
  type PayrollStatus,
} from "@/lib/payrollItems";

/** Billing/admin gate reused by every payroll entry point. */
async function assertBillingOrAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isBilling }, { data: isAdminBiller }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin_biller" }),
  ]);
  if (!isAdmin && !isBilling && !isAdminBiller)
    throw new Error("Forbidden: billing or admin only");
  return { isAdmin: !!isAdmin };
}

async function companyOf(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  return (data?.company_id as string | null) ?? null;
}

export type PayrollClaimRow = {
  trip_id: string;
  trip_date: string | null;
  passenger: string | null;
  medicaid_id: string | null;
  driver_id: string | null;
  driver_name: string;
  claim_number: string | null;
  claim_status: string | null;
  billed_amount: number | null;
  driver_pay_amount: number | null;
  payroll_status: PayrollStatus;
  payroll_item_id: string | null;
  submitted_at: string | null;
  paid_at: string | null;
  /** `manual_entry` = internal manual trip created in Claim History. */
  source: "system" | "manual" | "resubmission" | "manual_entry";
  same_day_flag: boolean;
};

const listInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  driver: z.string().optional(),
  passenger: z.string().optional(),
  claim_status: z.string().optional(),
  payroll_status: z.enum(PAYROLL_STATUSES).optional(),
  page: z.number().int().min(0).default(0),
  page_size: z.number().int().min(10).max(200).default(50),
});

/**
 * Claim History as a payroll source. Server-side filtered and paginated so a
 * company with tens of thousands of claims stays fast.
 */
export const listPayrollClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
  .handler(
    async ({
      context,
      data,
    }): Promise<{ rows: PayrollClaimRow[]; total: number; page: number; page_size: number }> => {
      const { supabase, userId } = context;
      await assertBillingOrAdmin(supabase, userId);
      const { computeClaimTotals } = await import("@/lib/claimAmount.server");
      const { resolveDriverPayForClaims } = await import("@/lib/payrollClaims.server");
      const { sameDayFlaggedTripIds } = await import("@/lib/sameDayBilling");

      const companyId = await companyOf(supabase, userId);

      let q = supabase
        .from("medicaid_trips")
        .select(
          "id, status, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, submitted_at, submitted_confirmation, portal_confirmation, portal_status, robot_last_status, robot_confirmation_number, robot_captured_claim, driver_id, paper_driver_name, dispatch_trip_id, riders(full_name, medicaid_id), medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
          { count: "exact" },
        )
        .or("status.eq.submitted,robot_confirmation_number.not.is.null,submitted_confirmation.not.is.null");

      if (companyId) q = q.eq("company_id", companyId);
      if (data.from) q = q.gte("pickup_at", data.from);
      if (data.to) q = q.lte("pickup_at", data.to);

      const start = data.page * data.page_size;
      const { data: trips, error, count } = await q
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .range(start, start + data.page_size - 1);
      if (error) throw new Error(error.message);

      const rows = (trips ?? []) as any[];
      const ids = rows.map((r) => r.id as string);

      const [{ data: records }, { data: items }, totals, payByTrip] = await Promise.all([
        ids.length
          ? supabase
              .from("billing_records")
              .select("trip_id, status, submitted_at, updated_at")
              .in("trip_id", ids)
          : Promise.resolve({ data: [] as any[] }),
        ids.length
          ? supabase
              .from("payroll_items")
              .select("id, ref_id, payroll_status")
              .eq("kind", "claim")
              .in("ref_id", ids)
          : Promise.resolve({ data: [] as any[] }),
        computeClaimTotals(supabase, rows),
        resolveDriverPayForClaims(supabase, companyId, rows),
      ]);


      const recOf = new Map(((records ?? []) as any[]).map((r) => [r.trip_id, r]));
      const itemOf = new Map(((items ?? []) as any[]).map((i) => [i.ref_id, i]));

      const flagged = sameDayFlaggedTripIds(
        rows.map((r) => ({
          trip_id: r.id,
          company_id: r.company_id ?? null,
          medicaid_id: r.riders?.medicaid_id ?? null,
          service_date: r.pickup_at,
        })),
      );

      let list: PayrollClaimRow[] = rows.map((r) => {
        const rec = recOf.get(r.id);
        const item = itemOf.get(r.id);
        const pay = payByTrip.get(r.id);
        const claimStatus =
          (rec?.status as string | null) ?? r.portal_status ?? r.robot_last_status ?? r.status ?? null;
        return {
          trip_id: r.id,
          trip_date: r.pickup_at ?? null,
          passenger: r.riders?.full_name ?? null,
          medicaid_id: r.riders?.medicaid_id ?? null,
          driver_id: pay?.driver_id ?? null,
          driver_name: pay?.driver_name ?? r.paper_driver_name ?? "Unassigned",
          claim_number:
            r.robot_confirmation_number ?? r.submitted_confirmation ?? r.portal_confirmation ?? null,
          claim_status: claimStatus,
          billed_amount: totals.get(r.id)?.amount ?? null,
          driver_pay_amount: pay?.amount ?? null,
          payroll_status: (item?.payroll_status as PayrollStatus) ?? "not_added",
          payroll_item_id: item?.id ?? null,
          submitted_at: r.submitted_at ?? rec?.submitted_at ?? null,
          paid_at: claimStatus === "paid" ? (rec?.updated_at ?? null) : null,
          source: r.paper_driver_name ? "manual" : "system",
          same_day_flag: flagged.has(r.id),
        };
      });

      const term = (data.passenger ?? "").trim().toLowerCase();
      if (term)
        list = list.filter(
          (r) =>
            (r.passenger ?? "").toLowerCase().includes(term) ||
            (r.medicaid_id ?? "").toLowerCase().includes(term),
        );
      const drv = (data.driver ?? "").trim().toLowerCase();
      if (drv) list = list.filter((r) => r.driver_name.toLowerCase().includes(drv));
      if (data.claim_status)
        list = list.filter((r) => (r.claim_status ?? "").toLowerCase() === data.claim_status);
      if (data.payroll_status) list = list.filter((r) => r.payroll_status === data.payroll_status);

      return { rows: list, total: count ?? list.length, page: data.page, page_size: data.page_size };
    },
  );

/**
 * Add one or many claim rows to payroll. Idempotent: the unique index on
 * (company_id, ref_id) means a repeated click, a refresh, or two billers
 * selecting the same claim can never create a second payroll line.
 */
export const addClaimsToPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { resolveDriverPayForClaims } = await import("@/lib/payrollClaims.server");
    const companyId = await companyOf(supabase, userId);

    const { data: trips, error } = await supabase
      .from("medicaid_trips")
      .select(
        "id, company_id, vehicle_type, odometer_start, odometer_end, pickup_at, driver_id, paper_driver_name, robot_confirmation_number, submitted_confirmation, riders(full_name), medicaid_trip_legs(leg_index, pickup_odometer, dropoff_odometer)",
      )
      .in("id", data.trip_ids);
    if (error) throw new Error(error.message);

    const rows = (trips ?? []) as any[];
    const payByTrip = await resolveDriverPayForClaims(supabase, companyId, rows);

    const payload = rows
      .map((r) => {
        const pay = payByTrip.get(r.id);
        if (!pay?.driver_id) return null;
        return {
          company_id: r.company_id ?? companyId,
          driver_id: pay.driver_id,
          kind: "claim",
          ref_id: r.id,
          service_date: r.pickup_at ? String(r.pickup_at).slice(0, 10) : null,
          passenger_name: r.riders?.full_name ?? null,
          description: "Claim payout",
          category: "claim",
          amount: round2(pay.amount ?? 0),
          payroll_status: "added" as const,
          claim_number: r.robot_confirmation_number ?? r.submitted_confirmation ?? null,
          created_by: userId,
        };
      })
      .filter(Boolean) as any[];

    const skipped = rows.length - payload.length;
    if (!payload.length) return { added: 0, skipped, duplicates: 0 };

    const { data: inserted, error: insErr } = await supabase
      .from("payroll_items")
      .upsert(payload, { onConflict: "company_id,ref_id", ignoreDuplicates: true })
      .select("id, ref_id, driver_id, amount");
    if (insErr) throw new Error(insErr.message);

    const added = (inserted ?? []).length;
    if (added) {
      await supabase.from("payroll_audit_log").insert(
        (inserted ?? []).map((i: any) => ({
          company_id: companyId,
          payroll_item_id: i.id,
          action: "added_to_payroll",
          actor_id: userId,
          notes: `Claim ${i.ref_id} added to payroll for $${i.amount}.`,
        })),
      );
    }
    return { added, skipped, duplicates: payload.length - added };
  });

const manualInput = z.object({
  driver_id: z.string().uuid(),
  service_date: z.string(),
  passenger_name: z.string().optional().nullable(),
  description: z.string().min(1),
  amount: z.number(),
  category: z.enum(MANUAL_CATEGORIES).default("other"),
  kind: z.enum(["manual", "adjustment"]).default("manual"),
  notes: z.string().optional().nullable(),
});

/** Manual payroll line for work handled outside the automated claim flow. */
export const createManualPayrollItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => manualInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const check = validateManualItem({
      kind: data.kind,
      amount: data.amount,
      description: data.description,
      driver_id: data.driver_id,
      service_date: data.service_date,
    });
    if (!check.ok) throw new Error(check.error);

    const { data: item, error } = await supabase
      .from("payroll_items")
      .insert({
        company_id: companyId,
        driver_id: data.driver_id,
        kind: data.kind,
        service_date: data.service_date.slice(0, 10),
        passenger_name: data.passenger_name ?? null,
        description: data.description,
        category: data.category,
        amount: round2(data.amount),
        payroll_status: "added",
        notes: data.notes ?? null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("payroll_audit_log").insert({
      company_id: companyId,
      payroll_item_id: item.id,
      action: data.kind === "adjustment" ? "manual_adjustment_created" : "manual_item_created",
      actor_id: userId,
      notes: `${data.description} — $${round2(data.amount)}`,
      data: { category: data.category },
    });
    return { id: item.id as string };
  });

/** Payroll rows for one driver (optionally a period) — table + print/PDF. */
export const listPayrollItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        driver_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        payroll_status: z.enum(PAYROLL_STATUSES).optional(),
        page: z.number().int().min(0).default(0),
        page_size: z.number().int().min(10).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    let q = supabase.from("payroll_items").select("*", { count: "exact" });
    if (companyId) q = q.eq("company_id", companyId);
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    if (data.from) q = q.gte("service_date", data.from.slice(0, 10));
    if (data.to) q = q.lte("service_date", data.to.slice(0, 10));
    if (data.payroll_status) q = q.eq("payroll_status", data.payroll_status);

    const start = data.page * data.page_size;
    const { data: rows, error, count } = await q
      .order("service_date", { ascending: false, nullsFirst: false })
      .range(start, start + data.page_size - 1);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as any[], total: count ?? 0 };
  });

/** Mark payroll lines paid (or back to added). Never touches claim status. */
export const setPayrollItemsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(1000),
        payroll_status: z.enum(PAYROLL_STATUSES),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const { error } = await supabase
      .from("payroll_items")
      .update({ payroll_status: data.payroll_status, updated_by: userId })
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    await supabase.from("payroll_audit_log").insert(
      data.ids.map((id) => ({
        company_id: companyId,
        payroll_item_id: id,
        action: "payroll_status_changed",
        actor_id: userId,
        notes: `Payroll status set to ${data.payroll_status}. Medicaid claim status unchanged.`,
      })),
    );
    return { updated: data.ids.length };
  });

/** Remove a payroll line that has not been paid yet. */
export const deletePayrollItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertBillingOrAdmin(supabase, userId);
    const { error } = await supabase
      .from("payroll_items")
      .delete()
      .eq("id", data.id)
      .neq("payroll_status", "paid");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
