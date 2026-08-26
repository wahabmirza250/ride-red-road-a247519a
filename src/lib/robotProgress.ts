/**
 * PER-CLAIM PROGRESS DISPLAY (pure).
 *
 * Turns whatever the automation service last reported into one short, honest
 * phrase for a normal biller. When the robot does not expose a stage, the UI
 * says "Working at HCPF" instead of inventing progress.
 */
import {
  JOB_NOT_FOUND_STATUS,
  SLOW_CLAIM_WARN_MS,
} from "@/lib/robotJobLost";

export type ClaimProgress = {
  label: string;
  /** 0-based index into the visible stage list, or null when unknown. */
  step: number | null;
  slow: boolean;
  elapsedMs: number | null;
  elapsedLabel: string;
};

/** Ordered, biller-readable stages. */
export const CLAIM_STAGES = [
  "Waiting",
  "Opening HCPF",
  "Entering claim",
  "Adding service lines",
  "Submitting",
  "Verifying",
  "Done",
] as const;

const UNKNOWN_LABEL = "Working at HCPF";

/** Map a raw robot/record status onto a visible stage, or null when unknown. */
export function claimStageOf(
  recordStatus: string | null | undefined,
  robotStatus: string | null | undefined,
): { label: string; step: number | null } {
  const rec = String(recordStatus ?? "").toLowerCase();
  if (rec === "queued") return { label: "Waiting", step: 0 };
  if (rec === "submitted") return { label: "Done", step: 6 };

  const s = String(robotStatus ?? "").toUpperCase();
  if (!s) return { label: UNKNOWN_LABEL, step: null };
  if (s === JOB_NOT_FOUND_STATUS) return { label: "Verifying", step: 5 };
  if (/QUEUED|PENDING|ACCEPTED/.test(s)) return { label: "Waiting", step: 0 };
  if (/LOGIN|LAUNCH|OPENING|NAVIGAT|PORTAL_OPEN|START/.test(s)) return { label: "Opening HCPF", step: 1 };
  if (/STEP1|CLAIM_INFO|ENTERING|FILLING|HEADER/.test(s)) return { label: "Entering claim", step: 2 };
  if (/SERVICE_LINE|STEP2|LINES/.test(s)) return { label: "Adding service lines", step: 3 };
  if (/SUBMIT|CONFIRM|STEP3/.test(s) && !/UNVERIFIED/.test(s)) return { label: "Submitting", step: 4 };
  if (/UNVERIFIED|VERIFY|LOOKUP|SEARCH/.test(s)) return { label: "Verifying", step: 5 };
  if (/^(SUBMITTED|CONFIRMED|SUCCESS|COMPLETED)$/.test(s)) return { label: "Done", step: 6 };
  if (/RUNNING|IN_PROGRESS|WORKING/.test(s)) return { label: UNKNOWN_LABEL, step: null };
  return { label: UNKNOWN_LABEL, step: null };
}

export function elapsedLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function claimProgress(input: {
  recordStatus?: string | null;
  robotStatus?: string | null;
  startedAt?: string | null;
  now?: number;
}): ClaimProgress {
  const now = input.now ?? Date.now();
  const t = input.startedAt ? Date.parse(input.startedAt) : NaN;
  const elapsedMs = Number.isFinite(t) ? Math.max(0, now - t) : null;
  const { label, step } = claimStageOf(input.recordStatus, input.robotStatus);
  return {
    label,
    step,
    elapsedMs,
    elapsedLabel: elapsedLabel(elapsedMs),
    slow: elapsedMs != null && elapsedMs >= SLOW_CLAIM_WARN_MS && label !== "Done",
  };
}
