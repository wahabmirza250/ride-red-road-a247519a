/**
 * NEEDS VERIFICATION — a state of its own, never "Needs fix".
 *
 * When a submission is interrupted AFTER the automation service accepted the
 * job (timeout, lost job, worker died mid-run, Submit/Confirm ambiguity), a
 * claim MAY already exist at HCPF. Editing or resubmitting such a bill risks a
 * real duplicate claim, so every ordinary action (Edit & fix, Resubmit, Move to
 * Ready to Submit) must be blocked until a human reconciles it against the
 * portal.
 *
 * Explicitly NOT in this state: pre-submit browser launch / capacity failures.
 * Those never reached the portal and stay ordinary recoverable queue cases.
 *
 * Pure module — no data access, safe on the client.
 */
import { isAmbiguousOutcomeMessage, isPreSubmitPacingCondition } from "@/lib/submitErrors";

/** Failure codes that mean "a claim may exist — verify before touching". */
export const VERIFICATION_FAILURE_CODES = [
  "stale_interrupted_unverified",
  "inflight_ceiling_unverified",
  "ambiguous_outcome",
  "needs_human_lookup",
  "job_not_found",
  "worker_unavailable_after_acceptance",
] as const;

/** Robot statuses that mean the outcome was never verified. */
export const VERIFICATION_ROBOT_STATUSES = [
  "SUBMITTED_UNVERIFIED",
  "NEEDS_HUMAN_LOOKUP",
  "JOB_NOT_FOUND",
] as const;

/** Marker written when a human checked the portal and found no claim. */
export const VERIFIED_NOT_SUBMITTED_STATUS = "VERIFIED_NOT_SUBMITTED";

/**
 * Text proving the job had already been ACCEPTED by a worker when it died.
 * "worker unavailable" only counts as ambiguous in this case.
 */
const POST_ACCEPTANCE_PATTERNS = [
  /job (?:was )?lost|no longer knows about this job/i,
  /worker stopped before the automation service confirmed/i,
  /JOB_NOT_FOUND/i,
  /SUBMITTED_UNVERIFIED/i,
  /NEEDS_HUMAN_LOOKUP/i,
  /never reported a final result/i,
  /after (?:login|signing in)/i,
];

export type VerificationCandidate = {
  status?: string | null;
  requires_human_step?: boolean | null;
  submission_error?: string | null;
  submit_last_error?: string | null;
  failure_code?: string | null;
  state_confirmation_number?: string | null;
  robot_confirmation_number?: string | null;
  submitted_confirmation?: string | null;
  robot_last_status?: string | null;
};

function messagesOf(rec: VerificationCandidate): string[] {
  return [rec.submission_error, rec.submit_last_error].filter(Boolean).map(String);
}

export function hasClaimEvidence(rec: VerificationCandidate): boolean {
  return !!(
    rec.state_confirmation_number ||
    rec.robot_confirmation_number ||
    rec.submitted_confirmation
  );
}

/**
 * Is this bill quarantined pending a MANUAL HCPF check?
 * True blocks Edit & fix / Resubmit / Move to Ready to Submit.
 */
export function requiresManualVerification(rec: VerificationCandidate): boolean {
  // A real claim number is a resolved outcome, not a verification case.
  if (hasClaimEvidence(rec)) return false;

  const robot = String(rec.robot_last_status ?? "");
  if ((VERIFICATION_ROBOT_STATUSES as readonly string[]).includes(robot)) return true;
  if (robot === VERIFIED_NOT_SUBMITTED_STATUS) return false;

  const code = String(rec.failure_code ?? "");
  if ((VERIFICATION_FAILURE_CODES as readonly string[]).includes(code)) return true;

  const msgs = messagesOf(rec);
  const postAcceptance = msgs.some((m) => POST_ACCEPTANCE_PATTERNS.some((re) => re.test(m)));
  if (postAcceptance) return true;
  if (msgs.some((m) => isAmbiguousOutcomeMessage(m) && !isPreSubmitPacingCondition(m))) return true;

  // A bare human-step flag with only pre-submit capacity evidence is NOT a
  // verification case — that stays an ordinary recoverable queue case.
  if (rec.requires_human_step) {
    if (msgs.length && msgs.every((m) => isPreSubmitPacingCondition(m))) return false;
    if (code === "worker_capacity" || code === "account_busy" || code === "portal_navigation")
      return false;
    return true;
  }
  return false;
}

export const AUTO_VERIFY_UNAVAILABLE_MESSAGE =
  "Automatic verification unavailable — manual HCPF check required.";

export const MANUAL_VERIFICATION_MESSAGE =
  "This submission was interrupted before a result was recorded, so a claim may already exist at HCPF. " +
  "Nothing was resubmitted. Check the portal yourself before any further action.";

const RAW_NOISE_PATTERNS = [
  /Cannot (?:POST|GET|PUT)\s+\/\S*/i,
  /<!DOCTYPE/i,
  /<\/?[a-z][^>]*>/i,
  /lookup HTTP \d+/i,
  /no read-only claim search/i,
  /non-JSON response/i,
  /lookup unreachable/i,
];

/**
 * Never show billers raw HTML, express 404 bodies or automation traces.
 * Anything that smells like machine output collapses to one plain sentence.
 */
export function sanitizeVerificationMessage(msg: string | null | undefined): string {
  const raw = String(msg ?? "").trim();
  if (!raw) return MANUAL_VERIFICATION_MESSAGE;
  if (RAW_NOISE_PATTERNS.some((re) => re.test(raw))) return AUTO_VERIFY_UNAVAILABLE_MESSAGE;
  const firstLine =
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^at\s|^Call log:/.test(l))[0] ?? raw;
  const clean = firstLine.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}

export type VerificationPanelInput = VerificationCandidate & {
  medicaid_id?: string | null;
  passenger_name?: string | null;
  service_date?: string | null;
  provider_account?: string | null;
  portal_id?: string | null;
  robot_job_id?: string | null;
};

export type VerificationPanel = {
  memberId: string;
  passengerName: string;
  serviceDate: string;
  providerAccount: string;
  jobId: string;
  message: string;
  instructions: string;
};

/** MM/DD/YYYY — the format the HCPF Search Claims screen expects. */
export function portalServiceDate(iso: string | null | undefined): string {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

export function verificationPanel(rec: VerificationPanelInput): VerificationPanel {
  const memberId = String(rec.medicaid_id ?? "").trim() || "—";
  const serviceDate = portalServiceDate(rec.service_date);
  return {
    memberId,
    passengerName: String(rec.passenger_name ?? "").trim() || "—",
    serviceDate,
    providerAccount: String(rec.provider_account ?? rec.portal_id ?? "").trim() || "—",
    jobId: String(rec.robot_job_id ?? "").trim() || "—",
    message: sanitizeVerificationMessage(rec.submission_error ?? rec.submit_last_error),
    instructions:
      `In the HCPF portal go to Claims → Search Claims and search for member ${memberId} ` +
      `with service date ${serviceDate}. Then record below whether a claim exists.`,
  };
}

/** Why an ordinary action is refused on a verification-blocked bill. */
export const VERIFICATION_BLOCK_REASON =
  "This bill is awaiting manual HCPF verification — editing, resubmitting and moving it to Ready to Submit are blocked until it is reconciled.";
