import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COMMISSION_BASES,
  PAY_PLANS,
  PER_TRIP_SOURCES,
  payPlanIssues,
  resolvePayPlan,
} from "@/lib/payPlans";
import { loadCompanyPaySettings, loadPayPlans } from "@/lib/payrollSources.server";

/** Pay plans are company money settings — admins of that company only. */
async function assertAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
) {
  const [{ data: role }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle(),
  ]);
  if (!role) throw new Error("Admin only");
  const companyId = (profile?.company_id as string | null) ?? null;
  if (!companyId) throw new Error("Your account is not attached to a company");
  return companyId;
}

/** Company defaults plus every driver's effective plan. */
export const getPayPlanSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase;
    const companyId = await assertAdmin(s, context.userId);

    const [company, { data: drivers }] = await Promise.all([
      loadCompanyPaySettings(s, companyId),
      s.from("drivers").select("id, user_id").eq("company_id", companyId).is("merged_into", null),
    ]);
    const rows = (drivers ?? []) as { id: string; user_id: string | null }[];
    const plans = await loadPayPlans(s, companyId, rows.map((d) => d.id));
    const [{ data: profiles }, { data: overrides }] = await Promise.all([
      rows.length
        ? s
            .from("profiles")
            .select("id, first_name, last_name, email")
            .in("id", rows.map((d) => d.user_id).filter(Boolean) as string[])
        : Promise.resolve({ data: [] as any[] }),
      rows.length
        ? s.from("driver_pay_plans").select("*").in("driver_id", rows.map((d) => d.id))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const pOf = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const oOf = new Map((overrides ?? []).map((o: any) => [o.driver_id, o]));

    return {
      company: company ?? {
        company_id: companyId,
        default_plan: "hourly" as const,
        hourly_rate: null,
        commission_percentage: null,
        per_trip_amount: null,
        commission_base: "unset" as const,
        per_trip_source: "completed_trips" as const,
      },
      drivers: rows.map((d) => {
        const p = d.user_id ? pOf.get(d.user_id) : null;
        const effective = plans.get(d.id) ?? resolvePayPlan(company ?? {}, null);
        return {
          driver_id: d.id,
          name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || (p?.email ?? "Driver"),
          override: oOf.get(d.id) ?? null,
          effective,
          issues: payPlanIssues(effective),
        };
      }),
    };
  });

const nullableNumber = z.number().min(0).nullable().optional();

/** Company-wide defaults every driver inherits unless overridden. */
export const saveCompanyPaySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        default_plan: z.enum(PAY_PLANS),
        hourly_rate: nullableNumber,
        commission_percentage: z.number().min(0).max(100).nullable().optional(),
        per_trip_amount: nullableNumber,
        commission_base: z.enum(COMMISSION_BASES),
        per_trip_source: z.enum(PER_TRIP_SOURCES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = context.supabase;
    const companyId = await assertAdmin(s, context.userId);
    const { error } = await s
      .from("company_pay_settings")
      .upsert({ company_id: companyId, ...data }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Per-driver override. Any field left null falls back to the company default. */
export const saveDriverPayPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        driver_id: z.string().uuid(),
        plan: z.enum(PAY_PLANS).nullable().optional(),
        hourly_rate: nullableNumber,
        commission_percentage: z.number().min(0).max(100).nullable().optional(),
        per_trip_amount: nullableNumber,
        commission_base: z.enum(["paid_claims", "submitted_claims", "estimated_fares"]).nullable().optional(),
        per_trip_source: z.enum(PER_TRIP_SOURCES).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = context.supabase;
    const companyId = await assertAdmin(s, context.userId);

    const { data: driver } = await s
      .from("drivers")
      .select("id")
      .eq("id", data.driver_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!driver) throw new Error("Driver not found in your company");

    const { error } = await s
      .from("driver_pay_plans")
      .upsert({ company_id: companyId, ...data }, { onConflict: "driver_id" });
    if (error) throw new Error(error.message);

    // Keep the legacy driver_pay row in step so older screens agree.
    if (data.plan || data.hourly_rate != null || data.commission_percentage != null) {
      await s.from("driver_pay").upsert(
        {
          driver_id: data.driver_id,
          ...(data.hourly_rate != null ? { hourly_rate: data.hourly_rate } : {}),
          ...(data.commission_percentage != null
            ? { payout_percentage: data.commission_percentage }
            : {}),
          ...(data.plan
            ? { pay_type: data.plan === "commission" ? "commission" : "per_hour" }
            : {}),
        },
        { onConflict: "driver_id" },
      );
    }
    return { ok: true };
  });
