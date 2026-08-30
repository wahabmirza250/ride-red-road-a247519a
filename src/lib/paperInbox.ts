/**
 * Pure helpers for the durable paper-bill inbox.
 *
 * Every paper trip report uploaded by a biller gets a `paper_inbox_files` row
 * the moment the file lands in storage. That row — not the browser tab — is the
 * source of truth for "did this upload finish becoming a trip + bill?", so a
 * refresh, timeout, closed browser or server restart can never lose an upload.
 */

export type PaperInboxStatus =
  | "uploaded" // stored, not read yet
  | "reading" // auto-read in flight
  | "needs_review" // read (or read failed) — waiting for the biller
  | "importing" // trip/bill creation in flight
  | "done" // trip + billing record exist
  | "error"; // last attempt failed, retryable

export type PaperInboxRow = {
  id: string;
  company_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime: string;
  content_hash: string | null;
  status: PaperInboxStatus;
  error: string | null;
  attempts: number;
  ocr: Record<string, any> | null;
  draft: Record<string, any> | null;
  trip_id: string | null;
  billing_record_id: string | null;
  processed_at: string | null;
  created_at: string;
};

/** A finished upload — never reprocessed, never duplicated. */
export function isComplete(row: Pick<PaperInboxRow, "status" | "trip_id">): boolean {
  return row.status === "done" && !!row.trip_id;
}

/** Anything a human still has to act on (or the system can retry). */
export function isOutstanding(row: Pick<PaperInboxRow, "status" | "trip_id">): boolean {
  return !isComplete(row);
}

/** Rows whose auto-read can safely be (re)attempted. */
export function canAutoRead(row: Pick<PaperInboxRow, "status" | "trip_id">): boolean {
  return !isComplete(row) && row.status !== "reading" && row.status !== "importing";
}

/**
 * Idempotency key for an upload. Content hash wins when known so the SAME
 * scanned page uploaded twice can never create two trips; the storage path is
 * the fallback because it is unique per stored object.
 */
export function inboxIdempotencyKey(
  row: Pick<PaperInboxRow, "company_id" | "storage_path" | "content_hash">,
): string {
  return `${row.company_id}|${row.content_hash ?? `path:${row.storage_path}`}`;
}

/** Short, honest label for the biller. */
export function statusLabel(row: Pick<PaperInboxRow, "status" | "error" | "trip_id">): string {
  switch (row.status) {
    case "uploaded":
      return "Stored — waiting to be read";
    case "reading":
      return "Auto-reading…";
    case "needs_review":
      return "Read — check the details and confirm";
    case "importing":
      return "Creating the trip and bill…";
    case "done":
      return row.trip_id ? "Imported — trip and bill created" : "Imported";
    case "error":
      return row.error ? `Failed — ${row.error}` : "Failed — retry";
    default:
      return row.status;
  }
}

/** SHA-256 of file bytes, used as the cross-upload duplicate fingerprint. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decide what to do with a freshly stored file given whatever the inbox
 * already knows about it. Never creates a second trip for the same content.
 */
export function reconcileUpload(args: {
  existingByPath?: Pick<PaperInboxRow, "id" | "status" | "trip_id"> | null;
  existingByHash?: Pick<PaperInboxRow, "id" | "status" | "trip_id"> | null;
}): { action: "reuse" | "duplicate" | "create"; rowId?: string } {
  const byPath = args.existingByPath;
  if (byPath) return { action: "reuse", rowId: byPath.id };
  const byHash = args.existingByHash;
  if (byHash && isComplete(byHash)) return { action: "duplicate", rowId: byHash.id };
  if (byHash) return { action: "reuse", rowId: byHash.id };
  return { action: "create" };
}

/** How long a read/import may stay in flight before it counts as interrupted. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Columns every inbox read returns. */
export const PAPER_INBOX_SELECT =
  "id, company_id, uploaded_by, storage_path, file_name, mime, content_hash, status, error, attempts, ocr, draft, trip_id, billing_record_id, processed_at, created_at";
