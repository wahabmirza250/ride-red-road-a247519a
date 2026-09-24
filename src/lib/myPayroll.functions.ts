import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getMyPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(v),
  )
  .handler(async ({ context, data }) => {
    if (
      Date.parse(data.to) <= Date.parse(data.from) ||
      Date.parse(data.to) - Date.parse(data.from) > 366 * 86400000
    )
      throw new Error("Choose a pay period of up to one year");
    const { data: driver, error } = await context.supabase
      .from("drivers")
      .select("id,company_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !driver?.company_id) throw new Error("Driver profile unavailable");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildPreview } = await import("@/lib/payroll.functions");
    // Identity and company come from the authenticated driver's row, never from input.
    const { calc, issues } = await buildPreview(
      supabaseAdmin,
      driver.company_id,
      driver.id,
      data.from,
      data.to,
    );
    const { data: payments, error: paymentError } = await supabaseAdmin
      .from("driver_payouts")
      .select("id,paid_at,total_paid,period_start,period_end")
      .eq("driver_id", driver.id)
      .is("voided_at", null)
      .gte("paid_at", data.from)
      .lte("paid_at", data.to)
      .order("paid_at", { ascending: false });
    if (paymentError) throw new Error("Payment history unavailable");
    return { calc: issues.length ? null : calc, issues, payments: payments ?? [] };
  });
