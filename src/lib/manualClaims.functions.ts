import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { round2, validateManualClaim } from "@/lib/manualClaims";

export type ManualClaimRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  passenger_name: string;
  service_date: string;
  claim_number: string | null;
  billed_amount: number | null;
  driver_pay_amount: number | null;
  claim_status: string | null;
  notes: string | null;
  created_at: string;
  payroll_status: "not_added" | "added" | "paid";
  payroll_item_id: string | null;
};

const createInput = z.object({
  driver_id: z.string().uuid(),
  passenger_name: z.string().min(1),
  service_date: z.string().min(8),
  claim_number: z.string().optional().nullable(),
  billed_amount: z.number().nullable().optional(),
  driver_pay_amount: z.number(),
  claim_status: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Create an INTERNAL manual trip that shows up in Claim History.
 * It is written to `manual_claim_records` only: it never enters the HCPF
 * submission queue and is never submitted, retried or reconciled.
 */
export const createManualClaimTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { assertBillingOrAdmin, companyOf } = await import("@/lib/manualClaims.server");
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const check = validateManualClaim(data);
    if (!check.ok) throw new Error(check.error);

    const { data: row, error } = await supabase
      .from("manual_claim_records")
      .insert({
        company_id: companyId,
        driver_id: data.driver_id,
        passenger_name: data.passenger_name.trim(),
        service_date: data.service_date.slice(0, 10),
        claim_number: data.claim_number?.trim() || null,
        billed_amount: data.billed_amount == null ? null : round2(data.billed_amount),
        driver_pay_amount: round2(data.driver_pay_amount),
        claim_status: data.claim_status || "internal",
        notes: data.notes?.trim() || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

/** Manual trips for Claim History / payroll, with their payroll state. */
export const listManualClaimTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<ManualClaimRow[]> => {
    const { supabase, userId } = context;
    const { assertBillingOrAdmin, companyOf, loadManualClaims, driverNames } = await import(
      "@/lib/manualClaims.server"
    );
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const records = await loadManualClaims(supabase, companyId, { from: data.from, to: data.to });
    if (!records.length) return [];

    const names = await driverNames(supabase, records.map((r) => r.driver_id));
    const { data: items } = await supabase
      .from("payroll_items")
      .select("id, ref_id, payroll_status")
      .eq("kind", "manual")
      .in("ref_id", records.map((r) => r.id));
    const itemOf = new Map(((items ?? []) as any[]).map((i) => [i.ref_id, i]));

    return records.map((r) => {
      const item = itemOf.get(r.id);
      return {
        id: r.id,
        driver_id: r.driver_id,
        driver_name: names.get(r.driver_id) ?? "Unassigned",
        passenger_name: r.passenger_name,
        service_date: r.service_date,
        claim_number: r.claim_number,
        billed_amount: r.billed_amount == null ? null : Number(r.billed_amount),
        driver_pay_amount: r.driver_pay_amount == null ? null : Number(r.driver_pay_amount),
        claim_status: r.claim_status,
        notes: r.notes,
        created_at: r.created_at,
        payroll_status: (item?.payroll_status as ManualClaimRow["payroll_status"]) ?? "not_added",
        payroll_item_id: item?.id ?? null,
      };
    });
  });

/** Record what actually happened to an internal manual trip. Never portal-bound. */
export const setManualClaimStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), claim_status: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { assertBillingOrAdmin } = await import("@/lib/manualClaims.server");
    await assertBillingOrAdmin(supabase, userId);
    const { error } = await supabase
      .from("manual_claim_records")
      .update({ claim_status: data.claim_status, updated_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete a manual trip that has not been paid out through payroll yet. */
export const deleteManualClaimTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { assertBillingOrAdmin } = await import("@/lib/manualClaims.server");
    await assertBillingOrAdmin(supabase, userId);

    const { data: item } = await supabase
      .from("payroll_items")
      .select("id, payroll_status")
      .eq("kind", "manual")
      .eq("ref_id", data.id)
      .maybeSingle();
    if (item?.payroll_status === "paid")
      throw new Error("This manual trip has already been paid on payroll and cannot be removed.");

    const { error } = await supabase.from("manual_claim_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Add manual trips to payroll using the biller's entered driver pay amount
 * EXACTLY. Pay plans are never applied. The unique index on
 * (company_id, ref_id) where kind = 'manual' makes a double-add impossible.
 */
export const addManualClaimsToPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ manual_ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { assertBillingOrAdmin, companyOf } = await import("@/lib/manualClaims.server");
    const { manualPayrollLine } = await import("@/lib/manualClaims");
    await assertBillingOrAdmin(supabase, userId);
    const companyId = await companyOf(supabase, userId);

    const { data: recs, error } = await supabase
      .from("manual_claim_records")
      .select("*")
      .in("id", data.manual_ids);
    if (error) throw new Error(error.message);

    const rows = (recs ?? []) as any[];
    if (!rows.length) return { added: 0, duplicates: 0 };

    const payload = rows.map((r) =>
      manualPayrollLine({ ...r, company_id: r.company_id ?? companyId }, userId),
    );

    const { data: inserted, error: insErr } = await supabase
      .from("payroll_items")
      .upsert(payload, { onConflict: "company_id,ref_id", ignoreDuplicates: true })
      .select("id, ref_id, amount");
    if (insErr) throw new Error(insErr.message);

    const added = (inserted ?? []).length;
    if (added) {
      await supabase.from("payroll_audit_log").insert(
        (inserted ?? []).map((i: any) => ({
          company_id: companyId,
          payroll_item_id: i.id,
          action: "manual_trip_added_to_payroll",
          actor_id: userId,
          notes: `Manual trip ${i.ref_id} added to payroll for $${i.amount} (amount entered by biller).`,
        })),
      );
    }
    return { added, duplicates: payload.length - added };
  });
