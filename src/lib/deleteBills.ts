/**
 * SHARED BILL-DELETION RULES.
 *
 * Used by both the server function and the browser fallback so the safety
 * rules — and, just as importantly, the honesty of the reported result — are
 * identical on both paths.
 *
 * Two real failure modes this guards against:
 *  1. A bill that already carries a portal confirmation number must NEVER be
 *     deleted, even if its billing status still reads "approved".
 *  2. RLS can silently delete ZERO rows when a plain biller tries to remove a
 *     bill entered by a different biller. Postgres returns no error for that,
 *     so we count the rows actually removed and report a real failure instead
 *     of a false "Deleted 2 bills".
 */

export const DELETABLE_STATUSES = ["pending_review", "approved", "needs_fix"] as const;

export type BillRow = {
  id: string;
  status: string;
  trip_id: string | null;
  state_confirmation_number: string | null;
};

export type BlockedBill = { id: string; reason: string };

export type DeleteBillsResult = {
  ok: true;
  deleted: number;
  skipped: number;
  blocked: BlockedBill[];
};

export function classifyBills(rows: BillRow[]) {
  const blocked: BlockedBill[] = [];
  const deletable: BillRow[] = [];
  for (const r of rows) {
    if (r.state_confirmation_number) {
      blocked.push({
        id: r.id,
        reason: `already submitted to Medicaid (portal confirmation #${r.state_confirmation_number})`,
      });
    } else if (!(DELETABLE_STATUSES as readonly string[]).includes(r.status)) {
      blocked.push({ id: r.id, reason: `in-flight or finalized (status "${r.status}")` });
    } else {
      deletable.push(r);
    }
  }
  return { blocked, deletable };
}

export function blockedOnlyMessage(blocked: BlockedBill[]): string {
  const first = blocked[0];
  return blocked.length === 1
    ? `This bill can't be deleted — it is ${first?.reason ?? "protected"}.`
    : `None of the ${blocked.length} selected bills can be deleted — e.g. one is ${first?.reason ?? "protected"}.`;
}

export const PERMISSION_MESSAGE =
  "Nothing was deleted — you don't have permission to remove these bills. " +
  "They were entered by another biller, so an admin (or an Admin Biller) has to delete them.";

/**
 * Performs the delete against any supabase client (server or browser) and
 * verifies the rows really went away.
 */
export async function performBillDelete(
  supabase: any,
  rows: BillRow[],
): Promise<DeleteBillsResult> {
  const { blocked, deletable } = classifyBills(rows);
  if (!deletable.length) throw new Error(blockedOnlyMessage(blocked));

  const ids = deletable.map((r) => r.id);

  // Children first — the audit log FKs back to the record.
  await supabase.from("billing_audit_log").delete().in("billing_record_id", ids);

  // `.select()` makes the delete report the rows it actually removed, which is
  // how an RLS no-op becomes a visible error instead of a fake success.
  const { data: gone, error: delErr } = await supabase
    .from("billing_records")
    .delete()
    .in("id", ids)
    .select("id, trip_id");
  if (delErr) throw new Error(delErr.message);

  const deletedRows: any[] = gone ?? [];
  if (!deletedRows.length) throw new Error(PERMISSION_MESSAGE);

  const tripIds = deletedRows.map((r) => r.trip_id).filter(Boolean);
  if (tripIds.length) {
    await supabase
      .from("medicaid_trips")
      .update({ status: "rejected", review_notes: "Deleted from the billing workflow." })
      .in("id", tripIds);
  }

  return {
    ok: true,
    deleted: deletedRows.length,
    skipped: rows.length - deletedRows.length,
    blocked,
  };
}
