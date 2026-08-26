import { describe, expect, it } from "vitest";
import {
  BILLING_PAGE_DESCRIPTION,
  PRIMARY_STAGES,
  SECONDARY_TOOLS,
  SUBMISSIONS_PAUSED_MESSAGE,
  WAITING_FOR_SLOT_MESSAGE,
  processingStateLabel,
  queueStatusStrip,
  queuedToastMessage,
} from "@/lib/billingUiCopy";

describe("billing workflow simplification", () => {
  it("shows exactly four primary stages in order", () => {
    expect(PRIMARY_STAGES.map((s) => s.label)).toEqual([
      "Review",
      "Ready to Submit",
      "Processing",
      "Submitted",
    ]);
  });

  it("keeps every secondary tool available, out of the main flow", () => {
    expect(SECONDARY_TOOLS.map((t) => t.key).sort()).toEqual([
      "claims_history",
      "denied",
      "medical_review",
      "payroll",
    ]);
  });

  it("never uses the old 'Awaiting Portal Submission' wording", () => {
    const all = [...PRIMARY_STAGES, ...SECONDARY_TOOLS].map((t) => t.label).join(" ");
    expect(all.toLowerCase()).not.toContain("awaiting portal");
  });
});

describe("plain-English processing states", () => {
  it("maps queue statuses to biller-readable text", () => {
    expect(processingStateLabel("queued")).toBe("Waiting for submission slot");
    expect(processingStateLabel("submitting")).toBe("Submitting to HCPF");
    expect(processingStateLabel("running")).toBe("Submitting to HCPF");
    expect(processingStateLabel("pending_submit")).toBe("Needs verification");
    expect(processingStateLabel("approved", { requiresHumanStep: true })).toBe(
      "Needs verification",
    );
  });
});

describe("copy accuracy", () => {
  it("does not claim the portal only allows one at a time", () => {
    const blob = [
      BILLING_PAGE_DESCRIPTION,
      SUBMISSIONS_PAUSED_MESSAGE,
      WAITING_FOR_SLOT_MESSAGE,
      queuedToastMessage(3),
    ]
      .join(" ")
      .toLowerCase();
    expect(blob).not.toContain("one at a time");
    expect(blob).toContain("different riders can process in parallel");
  });

  it("shows a single clear paused sentence", () => {
    expect(SUBMISSIONS_PAUSED_MESSAGE).toBe(
      "Submissions paused — no new claims will be sent. Status checks continue.",
    );
  });
});

describe("compact queue status strip", () => {
  it("reads as one simple line", () => {
    expect(
      queueStatusStrip({ paused: true, processing: 2, queued: 7, needsAttention: 1 }),
    ).toBe("Automation paused · 2 processing · 7 queued · 1 needs attention");
    expect(
      queueStatusStrip({ paused: false, processing: 0, queued: 0, needsAttention: 0 }),
    ).toBe("Automation running · 0 processing · 0 queued · 0 needs attention");
  });

  it("keeps technical jargon out of the default strip", () => {
    const s = queueStatusStrip({ paused: false, processing: 1, queued: 1, needsAttention: 0 });
    for (const word of ["lease", "stale", "worker", "fleet", "scheduler", "capacity"]) {
      expect(s.toLowerCase()).not.toContain(word);
    }
  });
});
