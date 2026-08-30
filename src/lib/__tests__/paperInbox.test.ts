import { describe, it, expect } from "vitest";
import {
  canAutoRead,
  inboxIdempotencyKey,
  isComplete,
  isOutstanding,
  reconcileUpload,
  sha256Hex,
  statusLabel,
  STUCK_AFTER_MS,
  type PaperInboxRow,
} from "@/lib/paperInbox";

const base: PaperInboxRow = {
  id: "row-1",
  company_id: "co-1",
  uploaded_by: "user-1",
  storage_path: "user-1/paper-inbox/a.pdf",
  file_name: "a.pdf",
  mime: "application/pdf",
  content_hash: "a".repeat(64),
  status: "uploaded",
  error: null,
  attempts: 0,
  ocr: null,
  draft: null,
  trip_id: null,
  billing_record_id: null,
  processed_at: null,
  created_at: "2026-08-30T16:19:00Z",
};

describe("paper inbox durability", () => {
  it("a successful upload → trip + bill is complete and never reprocessed", () => {
    const done: PaperInboxRow = {
      ...base,
      status: "done",
      trip_id: "trip-1",
      billing_record_id: "bill-1",
    };
    expect(isComplete(done)).toBe(true);
    expect(isOutstanding(done)).toBe(false);
    expect(canAutoRead(done)).toBe(false);
    expect(statusLabel(done)).toMatch(/trip and bill created/i);
  });

  it("post-upload processing failure stays visible and retryable", () => {
    const failed: PaperInboxRow = {
      ...base,
      status: "error",
      error: "Auto-read is busy right now",
    };
    expect(isComplete(failed)).toBe(false);
    expect(isOutstanding(failed)).toBe(true);
    expect(canAutoRead(failed)).toBe(true);
    expect(statusLabel(failed)).toContain("Auto-read is busy right now");
  });

  it("an interrupted read/import is never treated as finished", () => {
    for (const status of ["reading", "importing"] as const) {
      const row = { ...base, status };
      expect(isComplete(row)).toBe(false);
      expect(isOutstanding(row)).toBe(true);
      expect(canAutoRead(row)).toBe(false); // in flight; the sweep releases it
    }
    expect(STUCK_AFTER_MS).toBeGreaterThan(0);
  });

  it("reprocessing an already-tracked storage path reuses the same row", () => {
    expect(reconcileUpload({ existingByPath: base })).toEqual({
      action: "reuse",
      rowId: "row-1",
    });
  });

  it("re-uploading identical content that already produced a trip is a duplicate, not a new bill", () => {
    const done = { ...base, status: "done" as const, trip_id: "trip-1" };
    expect(reconcileUpload({ existingByPath: null, existingByHash: done })).toEqual({
      action: "duplicate",
      rowId: "row-1",
    });
  });

  it("re-uploading identical content that never imported reuses the unfinished row", () => {
    expect(reconcileUpload({ existingByPath: null, existingByHash: base })).toEqual({
      action: "reuse",
      rowId: "row-1",
    });
  });

  it("a genuinely new file creates a new inbox row", () => {
    expect(reconcileUpload({ existingByPath: null, existingByHash: null })).toEqual({
      action: "create",
    });
  });

  it("orphan adoption is idempotent per company + path/content", () => {
    const key = inboxIdempotencyKey(base);
    expect(inboxIdempotencyKey({ ...base, storage_path: "other/path.pdf" })).toBe(key);
    expect(inboxIdempotencyKey({ ...base, company_id: "co-2" })).not.toBe(key);
    const noHash = { ...base, content_hash: null };
    expect(inboxIdempotencyKey(noHash)).toContain("path:user-1/paper-inbox/a.pdf");
  });

  it("hashes the same bytes to the same fingerprint", async () => {
    const a = await sha256Hex(new TextEncoder().encode("paper trip report"));
    const b = await sha256Hex(new TextEncoder().encode("paper trip report"));
    const c = await sha256Hex(new TextEncoder().encode("another report"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
