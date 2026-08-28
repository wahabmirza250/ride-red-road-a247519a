import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling, logAudit } from "@/lib/billingHelpers";
import { decideAttentionAction } from "@/lib/needsAttentionArchive";

const SELECT =
  `id, status, requires_human_step, submission_error, fix_notes, failure_code,
   state_confirmation_number, attention_archived_at,
   medicaid_trips(robot_confirmation_number, submitted_confirmation, robot_last_status)`;

type Outcome = { id: string; ok: boolean; action: string; reason: string; confirmation?: string };

/**
 * Archive resolved / no-longer-actionable Needs Attention rows.
 *
 * Never deletes, never resets, never re-enables a retry: the only columns
 * written are the archive stamps, and every decision is journalled in the
 * billing audit log.
 */
export const archiveAttentionRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ archived: string[]; skipped: Outcome[] }> => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: rows, error } = await supabase
      .from("billing_records")
      .select(SELECT)
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    const archived: string[] = [];
    const skipped: Outcome[] = [];
    const nowIso = new Date().toISOString();

    for (const r of rows ?? []) {
      const trip: any = (r as any).medicaid_trips ?? {};
      const decision = decideAttentionAction({
        status: (r as any).status,
        requires_human_step: (r as any).requires_human_step,
        submission_error: (r as any).submission_error,
        fix_notes: (r as any).fix_notes,
        failure_code: (r as any).failure_code,
        state_confirmation_number: (r as any).state_confirmation_number,
        robot_confirmation_number: trip.robot_confirmation_number ?? null,
        submitted_confirmation: trip.submitted_confirmation ?? null,
        robot_last_status: trip.robot_last_status ?? null,
      });

      if (decision.action !== "archive") {
        skipped.push({
          id: (r as any).id,
          ok: false,
          action: decision.action,
          reason: decision.reason,
          ...(decision.action === "reconcile" ? { confirmation: decision.confirmation } : {}),
        });
        continue;
      }

      const note = data.reason?.trim() || decision.reason;
      const { error: upErr } = await supabase
        .from("billing_records")
        .update({
          attention_archived_at: nowIso,
          attention_archived_by: userId,
          attention_archive_reason: note.slice(0, 300),
        })
        .eq("id", (r as any).id)
        .is("attention_archived_at", null);
      if (upErr) {
        skipped.push({ id: (r as any).id, ok: false, action: "error", reason: "Could not archive." });
        continue;
      }
      archived.push((r as any).id);
      await logAudit(supabase, (r as any).id, userId, "attention_archived", note);
    }

    return { archived, skipped };
  });

/** Put an archived row back on the active worklist (history is untouched). */
export const unarchiveAttentionRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);
    const { error } = await supabase
      .from("billing_records")
      .update({
        attention_archived_at: null,
        attention_archived_by: null,
        attention_archive_reason: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, data.id, userId, "attention_unarchived", "Restored to Needs Attention");
    return { ok: true };
  });
