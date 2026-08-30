/**
 * THE ONE SUBMIT PATH (server-only).
 *
 * Every way a bill can be sent to the robot — the per-row button, the bulk
 * "Submit Claims" button and Auto Pilot — funnels through this function, so
 * they all get identical safety:
 *
 *   - manual-verification and uncertain outcomes are never blind-retried;
 *   - a bill that already carries a portal claim number needs an explicit,
 *     acknowledged resubmission;
 *   - full preflight runs before anything is queued (a failure parks THAT bill
 *     in Needs Fix and never aborts the rest);
 *   - enqueue is durable and idempotent (`account|trip_id|service_date|vN`),
 *     so two clicks on the same bill collapse into one job while two distinct
 *     trips of the same passenger on the same day both go through.
 */
import {
  UNVERIFIED_SUBMIT_STATUS,
  assertRobotSubmissionPreflight,
} from "@/lib/billingHelpers";
import { REAL_SUBMISSIONS_PAUSED } from "@/lib/submissionPause";
import type { SkipCode } from "@/lib/submitSkip";

export type SubmitSelectionResult = {
  queued: number;
  started: number;
  startedIds: string[];
  skipped: Array<{ id: string; reason: string; code: SkipCode; claim?: string | null }>;
  duplicates: string[];
  failed: Array<{ id: string; reason: string }>;
  batch_id: string | null;
};

/** Statuses a bill may be submitted from. */
export const SUBMITTABLE_STATUSES = ["approved", "needs_fix", "pending_submit", "queued"] as const;

export async function submitSelectedRecords(
  supabase: any,
  userId: string,
  args: { ids: string[]; acknowledgeDuplicate?: boolean; label?: string | null },
): Promise<SubmitSelectionResult> {
  if (REAL_SUBMISSIONS_PAUSED) {
    throw new Error(
      "Real portal submissions are paused while service-line verification is being fixed.",
    );
  }

  const { isSubmissionQueuePaused, dispatchLeasedSubmissions } = await import(
    "@/lib/submissionQueue.server"
  );
  const { paused, reason } = await isSubmissionQueuePaused(supabase);
  if (paused) {
    throw new Error(
      reason ?? "Automatic portal submissions are paused. Resume them in Billing settings.",
    );
  }

  const { data: recs, error: recErr } = await supabase
    .from("billing_records")
    .select(
      `id, status, trip_id, requires_human_step,
         medicaid_trips!inner(
            id, company_id, pickup_at, odometer_start, odometer_end, signature_path,
            state_pdf_path, identity_verified, robot_last_status, status, portal_status,
            robot_confirmation_number, submitted_confirmation,
            vehicle_type, trip_kind, rider_id,
            riders(medicaid_id)
         )`,
    )
    .in("id", args.ids);
  if (recErr) throw new Error(recErr.message);

  const { requiresManualVerification } = await import("@/lib/needsVerification");

  const acknowledgeDuplicate = Boolean(args.acknowledgeDuplicate);
  const skipped: SubmitSelectionResult["skipped"] = [];
  const duplicates: string[] = [];
  const companies = new Set<string | null>();
  const candidates: Array<{
    id: string;
    companyId: string | null;
    tripId: string;
    serviceDate: string | null;
    resubmit: boolean;
  }> = [];

  for (const rec of recs ?? []) {
    const trip: any = (rec as any).medicaid_trips;
    const priorClaim: string | null =
      trip?.robot_confirmation_number ?? trip?.submitted_confirmation ?? null;
    const unverified = trip?.robot_last_status === UNVERIFIED_SUBMIT_STATUS;
    const isResubmit = !!priorClaim || unverified;

    if (
      requiresManualVerification({
        status: rec.status,
        requires_human_step: (rec as any).requires_human_step,
        robot_confirmation_number: trip?.robot_confirmation_number ?? null,
        submitted_confirmation: trip?.submitted_confirmation ?? null,
        robot_last_status: trip?.robot_last_status ?? null,
      })
    ) {
      skipped.push({
        id: rec.id as string,
        code: "needs_verification",
        reason: "awaiting manual HCPF verification",
      });
      continue;
    }

    if (isResubmit && !acknowledgeDuplicate) {
      duplicates.push(rec.id as string);
      // A real claim number is terminal evidence; an unverified outcome is
      // NOT a submitted claim and must never be labelled as one.
      skipped.push(
        priorClaim
          ? {
              id: rec.id as string,
              code: "submitted_claim",
              claim: priorClaim,
              reason: `already submitted as claim #${priorClaim}`,
            }
          : {
              id: rec.id as string,
              code: "unverified_outcome",
              claim: null,
              reason: "previous attempt reached the portal but was never verified",
            },
      );
      continue;
    }
    // Corrupt mileage / impossible service date must never be sent.
    {
      const { claimSanityIssues, milesFromOdometer } = await import("@/lib/claimSanity");
      const issues = claimSanityIssues({
        billed_miles: milesFromOdometer(trip?.odometer_start, trip?.odometer_end),
        service_date: trip?.pickup_at ?? null,
      });
      if (issues.length) {
        skipped.push({
          id: rec.id as string,
          code: "missing_data",
          reason: issues[0]!.message,
        });
        await supabase
          .from("billing_records")
          .update({
            status: "needs_fix",
            submission_error: issues[0]!.message,
            fix_notes: issues[0]!.message,
            requires_human_step: true,
            failure_stage: "preflight",
            failure_code: issues[0]!.code,
          })
          .eq("id", rec.id);
        continue;
      }
    }
    if ((rec as any).requires_human_step) {
      skipped.push({
        id: rec.id as string,
        code: "needs_verification",
        reason: "needs verification before retry",
      });
      continue;
    }
    if (
      !(SUBMITTABLE_STATUSES as readonly string[]).includes(rec.status as string) &&
      !(isResubmit && acknowledgeDuplicate)
    ) {
      skipped.push({
        id: rec.id as string,
        code: "not_submittable",
        reason: `status "${rec.status}"`,
      });
      continue;
    }
    try {
      await assertRobotSubmissionPreflight(supabase, {
        billingRecordId: rec.id as string,
        trip,
        providerUserId: userId,
        mode: "full",
      });
    } catch (e) {
      // FAIL CLOSED for this bill only; the rest of the selection keeps going.
      const msg =
        e instanceof Error ? e.message : "Submission blocked: required claim data is missing.";
      skipped.push({ id: rec.id as string, code: "missing_data", reason: msg });
      await supabase
        .from("billing_records")
        .update({
          status: "needs_fix",
          submission_error: msg,
          fix_notes: msg,
          requires_human_step: true,
          failure_stage: "preflight",
          failure_code: "missing_required_data",
        })
        .eq("id", rec.id);
      continue;
    }

    candidates.push({
      id: rec.id as string,
      companyId: trip?.company_id ?? null,
      tripId: (rec as any).trip_id ?? trip?.id,
      serviceDate: trip?.pickup_at ?? null,
      resubmit: isResubmit && acknowledgeDuplicate,
    });
    companies.add(trip?.company_id ?? null);
  }

  if (candidates.length === 0) {
    return {
      queued: 0,
      started: 0,
      startedIds: [],
      skipped,
      duplicates,
      failed: [],
      batch_id: null,
    };
  }

  const { enqueueSubmissionBatch } = await import("@/lib/submissionBatch.server");
  const batch = await enqueueSubmissionBatch(supabase, {
    actorId: userId,
    candidates,
    label: args.label ?? `Batch of ${candidates.length}`,
  });
  duplicates.push(...batch.duplicates);
  for (const d of batch.duplicates)
    skipped.push({
      id: d,
      code: "already_queued",
      reason: "already queued or sending — the extra request was ignored",
    });
  for (const f of batch.failed) skipped.push({ id: f.id, code: "enqueue_failed", reason: f.reason });

  // Best-effort immediate kick so the first bill starts without waiting for the
  // next tick. Bounded by the same leases: it can never exceed the caps, and
  // anything not started simply stays queued.
  const startedIds: string[] = [];
  for (const companyId of companies) {
    try {
      const res = await dispatchLeasedSubmissions(supabase, userId, {
        companyId: companyId ?? null,
        worker: `bulk-${userId.slice(0, 8)}`,
      });
      startedIds.push(...res.startedIds);
    } catch {
      // Anything not started stays `queued`; the workers pick it up.
    }
  }

  return {
    queued: batch.enqueued.length,
    started: startedIds.length,
    startedIds,
    skipped,
    duplicates,
    failed: batch.failed,
    batch_id: batch.batchId,
  };
}
