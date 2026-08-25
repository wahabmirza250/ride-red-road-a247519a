/**
 * Server helpers for internal manual trips. Read/write `manual_claim_records`
 * only — nothing here ever touches the HCPF submission queue.
 */

import type { ManualClaimRecord } from "@/lib/manualClaims";

type Sb = any;

export async function assertBillingOrAdmin(supabase: Sb, userId: string) {
  const [{ data: isAdmin }, { data: isBilling }, { data: isAdminBiller }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "billing" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin_biller" }),
  ]);
  if (!isAdmin && !isBilling && !isAdminBiller) throw new Error("Forbidden: billing or admin only");
  return { isAdmin: !!isAdmin };
}

export async function companyOf(supabase: Sb, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.company_id as string | null) ?? null;
}

/** Map `drivers.id` → display name, for grouping manual trips by driver. */
export async function driverNames(
  supabase: Sb,
  driverIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(driverIds.filter(Boolean))];
  if (!ids.length) return out;
  const { data: drivers } = await supabase.from("drivers").select("id, user_id").in("id", ids);
  const rows = (drivers ?? []) as any[];
  const userIds = rows.map((d) => d.user_id).filter(Boolean);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", userIds)
    : { data: [] as any[] };
  const nameOf = new Map(
    ((profiles ?? []) as any[]).map((p) => [
      p.id as string,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    ]),
  );
  for (const d of rows) out.set(d.id as string, nameOf.get(d.user_id) || "Unassigned");
  return out;
}

export type ManualClaimFilters = {
  from?: string;
  to?: string;
  driver_id?: string;
};

export async function loadManualClaims(
  supabase: Sb,
  companyId: string | null,
  filters: ManualClaimFilters = {},
): Promise<ManualClaimRecord[]> {
  let q = supabase.from("manual_claim_records").select("*");
  if (companyId) q = q.eq("company_id", companyId);
  if (filters.from) q = q.gte("service_date", filters.from.slice(0, 10));
  if (filters.to) q = q.lte("service_date", filters.to.slice(0, 10));
  if (filters.driver_id) q = q.eq("driver_id", filters.driver_id);
  const { data, error } = await q.order("service_date", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualClaimRecord[];
}
