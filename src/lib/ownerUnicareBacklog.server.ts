import { assertRobotSubmissionPreflight } from "@/lib/billingHelpers";
import { requiresManualVerification, hasClaimEvidence } from "@/lib/needsVerification";
import { resolveBillingProviderId } from "@/lib/providerResolve.server";
import { REAL_SUBMISSIONS_PAUSED } from "@/lib/submissionPause";
import { enqueueSubmissionBatch, type BatchCandidate } from "@/lib/submissionBatch.server";
import { dispatchLeasedSubmissions, isSubmissionQueuePaused } from "@/lib/submissionQueue.server";

// The owner's October 10 request covers this existing backlog only. New
// uploads and other companies cannot enter this recovery through the client.
export const UNICARE_BACKLOG_COMPANY = "c246bbf7-a748-47cc-b1b4-a723395567a8";
const EXPECTED_PROVIDER = "b072fccb-9504-41b7-bd30-abfec407ec68";
export const UNICARE_BACKLOG_IDS = [
  "03e97b31-61e5-4125-870a-fff11bbede5d", "24da82ca-a2ec-4263-9bc3-8e747e9aeb02",
  "34faabf3-8027-46c2-b4c8-84ae209da2b2", "4850407e-4c8f-4c0b-89e5-57b070b5acbe",
  "5c6fb2fc-f2c5-43ff-95c2-776fffb5b4b9", "664e6d3c-03e4-4008-87f9-b606dd251cc3",
  "6f914045-0514-43e0-b580-b0a80e1e2283", "716512c7-dc96-4f7e-99a9-821bb3a6c854",
  "83506c1c-671d-4d54-8ea6-142a72beb891", "895934aa-2523-4204-a5c2-f75579116907",
  "8b4eaf27-f1a9-484c-8be6-69e3bdc8eac3", "998acb2f-c24e-4d7d-adb3-3aebcc333a72",
  "9b901d16-814c-44e9-bc0a-2c6b918300a3", "ab018cd6-89a5-4684-8d9e-f08712dfc959",
  "bb715212-f9a1-4853-9dd5-8c6fc600a64c", "c87d2924-e97c-4c53-acd6-1ae2b82fdb8e",
  "db9c9034-39e6-46c0-a37a-a6e045953c32", "fe3f89e4-ab64-4b79-9630-ce3c2f5f0e74",
  "14de9c0e-0fe4-4855-b200-b8aa73ddd465", "174da3b6-c89f-4d0b-881e-717ad247d01d",
  "2946c226-b245-485c-82dc-2c23ba96f9d9", "30ccc3b9-73a3-4a71-b4f8-80e054c3c550",
  "952256bd-7d24-4134-8762-6a8929030810", "b838a0ed-6845-4cc4-8cc1-4c68941e4849",
  "bd6b513c-2325-4a29-ad95-42c8550de6b4", "ca62c1fd-7524-4a94-a2ca-aa68eef1891a",
  "cc050abb-5724-4f54-98d1-6dd018b34633", "d799700d-ec5e-4ab8-92f0-b3b2403e43b6",
  "daee328c-94a9-436c-9c1c-f100cc1e6b4f", "de5ceee3-3b17-446a-a4df-289fce17cc29",
  "eaccc9d4-0453-49a0-8838-137ff661e36a", "f5d2724d-b81a-4f19-81ee-0940364a10c7",
] as const;

export async function processOwnerUnicareBacklog(db: any, actorId: string) {
  if (REAL_SUBMISSIONS_PAUSED) throw new Error("Real portal submissions are paused.");
  const pause = await isSubmissionQueuePaused(db);
  if (pause.paused) throw new Error(pause.reason ?? "Submission queue is paused.");
  const provider = await resolveBillingProviderId(db, UNICARE_BACKLOG_COMPANY);
  if (provider !== EXPECTED_PROVIDER) throw new Error("Unicare billing provider changed; review the provider before continuing.");

  const { data: rows, error } = await db.from("billing_records").select(`
    id, company_id, status, state_confirmation_number, requires_human_step,
    failure_code, submission_error, submit_last_error, submit_attempt_count,
    medicaid_trips!inner(id, company_id, pickup_at, miles, odometer_start,
      odometer_end, signature_path, state_pdf_path, identity_verified,
      robot_job_id, robot_last_status, robot_confirmation_number,
      submitted_confirmation, status, portal_status, vehicle_type, trip_kind,
      rider_id, riders(medicaid_id))
  `).eq("company_id", UNICARE_BACKLOG_COMPANY).in("id", [...UNICARE_BACKLOG_IDS]);
  if (error) throw new Error(error.message);
  const candidates: BatchCandidate[] = [];
  const dispatchIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const row of rows ?? []) {
    const trip = row.medicaid_trips;
    const evidence = { ...row, robot_last_status: trip?.robot_last_status,
      robot_confirmation_number: trip?.robot_confirmation_number,
      submitted_confirmation: trip?.submitted_confirmation };
    if (row.company_id !== UNICARE_BACKLOG_COMPANY || trip?.company_id !== UNICARE_BACKLOG_COMPANY ||
        !["approved", "queued"].includes(row.status) || row.requires_human_step ||
        requiresManualVerification(evidence) || hasClaimEvidence(evidence) || trip.robot_job_id ||
        Number(row.submit_attempt_count ?? 0) !== 0 || row.submit_last_error || row.failure_code) {
      skipped.push({ id: row.id, reason: "Already attempted, held, or no longer ready." });
      continue;
    }
    if (!(Number(trip.miles) > 0 && Number(trip.miles) <= 50)) {
      skipped.push({ id: row.id, reason: "Mileage needs review." });
      continue;
    }
    try {
      await assertRobotSubmissionPreflight(db, {
        billingRecordId: row.id, trip, providerUserId: provider, mode: "full",
      });
    } catch (e) {
      skipped.push({ id: row.id, reason: e instanceof Error ? e.message : "Preflight failed." });
      continue;
    }
    if (row.status === "approved") candidates.push({
      id: row.id, companyId: UNICARE_BACKLOG_COMPANY, tripId: trip.id,
      serviceDate: trip.pickup_at, resubmit: false, requireFreshApproved: true,
    });
    else dispatchIds.push(row.id);
  }
  const batch = await enqueueSubmissionBatch(db, {
    actorId, candidates, label: "Owner-authorized Unicare October 10 backlog",
  });
  dispatchIds.push(...batch.enqueued);
  const result = dispatchIds.length ? await dispatchLeasedSubmissions(db, actorId, {
    companyId: UNICARE_BACKLOG_COMPANY, recordIds: dispatchIds, worker: "owner-unicare-oct10",
  }) : { started: 0, startedIds: [] };
  return { enqueued: batch.enqueued.length, existingQueued: dispatchIds.length - batch.enqueued.length,
    skipped, enqueueFailures: batch.failed, ...result };
}
