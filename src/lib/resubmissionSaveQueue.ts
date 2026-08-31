/**
 * SAVE-THEN-QUEUE ORCHESTRATION (pure, dependency-injected).
 *
 * Root cause this module fixes: "Queue corrected claim for HCPF" used to send
 * only the resubmission id, so the server queued whatever was in the DATABASE
 * draft — which, for drafts that were never explicitly saved, is null. The
 * editor validated the in-memory snapshot (which passed) while the server
 * validated the stale row (which failed with "Service date is required").
 *
 * The queue action now always carries the CURRENT editor snapshot and runs a
 * strict sequence: validate -> persist -> read back -> audit -> queue once.
 * Any failure before the last step creates NO queue job; a failure of the last
 * step leaves the corrected draft safely saved.
 */
import type { DraftIssue, DraftSnapshot } from "@/lib/resubmissionDraft";

export type EditorTab = "trip" | "legs" | "lines";

/** Which editor tab owns a validation field, so the UI can focus it. */
export function tabForField(field: string | null | undefined): EditorTab {
  const f = String(field ?? "");
  if (f.startsWith("legs")) return "legs";
  if (f.startsWith("lines")) return "lines";
  return "trip";
}

export function firstIssue(issues: DraftIssue[] | undefined | null): DraftIssue | null {
  return (issues ?? [])[0] ?? null;
}

export type ReadBack = {
  draft_snapshot: { service_date?: string | null } | null;
  draft_version: number | null;
  lines: { line_index: number; service_date: string | null }[];
};

/**
 * Proof that the corrected values really landed in the database before we let
 * anything be queued.
 */
export function readBackMatches(
  readback: ReadBack | null,
  expected: { service_date: string | null; version: number; lineDates: (string | null)[] },
): { ok: boolean; reason: string } {
  if (!readback?.draft_snapshot)
    return { ok: false, reason: "The corrected draft could not be read back after saving." };
  if ((readback.draft_snapshot.service_date ?? null) !== expected.service_date)
    return { ok: false, reason: "The saved service date does not match the corrected draft." };
  if (Number(readback.draft_version ?? 0) !== Number(expected.version))
    return { ok: false, reason: "The corrected draft was changed by someone else while saving." };
  const saved = [...readback.lines]
    .sort((a, b) => a.line_index - b.line_index)
    .map((l) => l.service_date ?? null);
  if (saved.length !== expected.lineDates.length)
    return { ok: false, reason: "The saved service lines do not match the corrected draft." };
  for (let i = 0; i < saved.length; i++)
    if (saved[i] !== (expected.lineDates[i] ?? null))
      return { ok: false, reason: "The saved service-line dates do not match the corrected draft." };
  return { ok: true, reason: "" };
}

export type SaveQueueResult =
  | { kind: "queued"; version: number; trip_id?: string | null; idempotency_key?: string | null }
  | { kind: "invalid"; reason: string; field: string | null; tab: EditorTab; issues: DraftIssue[] }
  | { kind: "conflict"; reason: string }
  | { kind: "saved_not_queued"; version: number; reason: string };

export type SaveQueueDeps = {
  /** Current row, already company-scoped and permission-checked. */
  load: () => Promise<{ status: string; draft_version: number | null } | null>;
  validate: (snap: DraftSnapshot) => { ok: boolean; issues: DraftIssue[] };
  /** Persist snapshot + synchronized service lines. Returns the new version. */
  persist: (snap: DraftSnapshot) => Promise<number>;
  readBack: () => Promise<ReadBack | null>;
  audit: (action: "draft_saved" | "draft_reviewed" | "draft_queued", version: number) => Promise<void>;
  queue: (snap: DraftSnapshot) => Promise<{
    queued: boolean;
    reason?: string;
    trip_id?: string | null;
    idempotency_key?: string | null;
  }>;
};

export async function runSaveAndQueue(
  deps: SaveQueueDeps,
  args: { snapshot: DraftSnapshot; confirm: boolean; expected_version?: number | null },
): Promise<SaveQueueResult> {
  if (args.confirm !== true)
    return { kind: "conflict", reason: "Queueing a corrected claim needs an explicit confirmation." };

  const row = await deps.load();
  if (!row) return { kind: "conflict", reason: "Resubmission not found." };
  // `queued` = Ready to Submit: nothing has been handed to a worker, so the
  // biller may still correct it and re-confirm. Only `processing` and beyond
  // are closed to edits.
  if (row.status !== "draft" && row.status !== "queued")
    return {
      kind: "conflict",
      reason: `This resubmission is already ${row.status} — nothing was queued a second time.`,
    };
  if (
    args.expected_version != null &&
    Number(args.expected_version) !== Number(row.draft_version ?? 1)
  )
    return {
      kind: "conflict",
      reason:
        "This draft was edited in another tab or by another biller. Reopen it to load the latest corrections.",
    };

  const validation = deps.validate(args.snapshot);
  if (!validation.ok) {
    const issue = firstIssue(validation.issues);
    return {
      kind: "invalid",
      reason: issue?.message ?? "The corrected claim is not valid yet.",
      field: issue?.field ?? null,
      tab: tabForField(issue?.field),
      issues: validation.issues,
    };
  }

  // Persist + prove it landed. Any throw here happens BEFORE any queue job.
  const version = await deps.persist(args.snapshot);
  const proof = readBackMatches(await deps.readBack(), {
    service_date: args.snapshot.service_date ?? null,
    version,
    lineDates: args.snapshot.lines.map((l) => l.service_date ?? null),
  });
  if (!proof.ok) return { kind: "conflict", reason: proof.reason };

  await deps.audit("draft_saved", version);
  await deps.audit("draft_reviewed", version);

  try {
    const res = await deps.queue(args.snapshot);
    if (!res.queued)
      return { kind: "saved_not_queued", version, reason: res.reason ?? "Nothing to queue." };
    await deps.audit("draft_queued", version);
    return {
      kind: "queued",
      version,
      trip_id: res.trip_id ?? null,
      idempotency_key: res.idempotency_key ?? null,
    };
  } catch (e) {
    // The corrections are saved; the biller loses no work and no partial job exists.
    return {
      kind: "saved_not_queued",
      version,
      reason: `Your corrections were saved, but the claim could not be queued: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
