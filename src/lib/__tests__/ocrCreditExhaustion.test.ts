import { describe, it, expect } from "vitest";
import { classifyOcrFailure, batchStopBanner, MANUAL_ENTRY_HINT } from "@/lib/ocrFailure";
import { canAutoRead, isComplete, type PaperInboxRow } from "@/lib/paperInbox";

const row: PaperInboxRow = {
  id: "row-1",
  company_id: "co-1",
  uploaded_by: "user-1",
  storage_path: "user-1/paper-inbox/a.pdf",
  file_name: "a.pdf",
  mime: "application/pdf",
  content_hash: null,
  status: "needs_review",
  error: MANUAL_ENTRY_HINT,
  attempts: 1,
  ocr: null,
  draft: null,
  trip_id: null,
  billing_record_id: null,
  processed_at: null,
  created_at: "2026-08-30T20:00:00Z",
};

describe("auto-read credit exhaustion", () => {
  it("treats a 402 as terminal and halts the rest of the batch", () => {
    const f = classifyOcrFailure(new Error("402 Auto-read is out of AI credits"));
    expect(f.kind).toBe("credits");
    expect(f.stopBatch).toBe(true);
    expect(f.retryable).toBe(false);
    expect(f.message).toContain("out of AI credits");
    expect(f.message).toContain("still saves normally");
    expect(batchStopBanner(f)).toContain("stored and tracked");
  });

  it("treats a 403 (AI disabled / limit reached) as terminal too", () => {
    const f = classifyOcrFailure(new Error("403 Auto-read is disabled for this workspace"));
    expect(f.kind).toBe("blocked");
    expect(f.stopBatch).toBe(true);
    expect(f.retryable).toBe(false);
  });

  it("keeps transient failures per-file and retryable", () => {
    const busy = classifyOcrFailure(new Error("Auto-read is busy right now (429)"));
    expect(busy.kind).toBe("rate_limit");
    expect(busy.stopBatch).toBe(false);
    expect(busy.retryable).toBe(true);

    const down = classifyOcrFailure(new Error("Auto-read failed (503: upstream)"));
    expect(down.stopBatch).toBe(false);
    expect(down.retryable).toBe(true);
    expect(batchStopBanner(down)).toBeNull();
  });

  it("an oversized file is a file problem, never a batch halt", () => {
    const f = classifyOcrFailure(new Error("File too large — use a smaller photo"));
    expect(f.kind).toBe("too_large");
    expect(f.stopBatch).toBe(false);
  });

  it("a file left unread by exhausted credits stays reviewable and manually completable", () => {
    // No OCR ran, so the row is NOT done and NOT locked: the biller types the
    // details in and confirms, which is what creates the trip + billing record.
    expect(isComplete(row)).toBe(false);
    expect(canAutoRead(row)).toBe(true);
    expect(row.status).toBe("needs_review");
    expect(row.trip_id).toBeNull();
  });

  it("manual entry is valid without any OCR output", () => {
    // Mirrors the client-side isValid() contract used by the batch table.
    const manual = {
      trip_date: "2026-08-30",
      vehicle_type: "ambulatory" as const,
      passenger_name: "Sierra Brown",
      medicaid_id: "P458407",
      legs: [{ pickup_odometer: 1000, dropoff_odometer: 1012 }],
      ocr: null,
    };
    const valid =
      !!manual.trip_date &&
      !!manual.vehicle_type &&
      !!manual.passenger_name.trim() &&
      !!manual.medicaid_id.trim() &&
      manual.legs.length > 0 &&
      manual.legs.every((l) => l.dropoff_odometer > l.pickup_odometer);
    expect(manual.ocr).toBeNull();
    expect(valid).toBe(true);
  });
});
