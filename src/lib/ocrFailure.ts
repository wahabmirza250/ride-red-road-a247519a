/**
 * Classification of paper-bill auto-read (OCR) failures.
 *
 * Auto-read is a convenience layer on top of the paper inbox: a paper bill can
 * always be typed in by hand and still create its trip + billing record. What
 * matters is telling the biller honestly WHY the read stopped, and — for
 * terminal gateway conditions like exhausted AI credits — stopping the rest of
 * the batch instead of burning a failed request per file.
 */
export type OcrFailureKind =
  | "credits" // 402 — workspace AI credits exhausted (terminal)
  | "blocked" // 403 — AI disabled or a workspace limit was reached (terminal)
  | "rate_limit" // 429 — transient, retry later
  | "too_large" // file exceeds the read limit
  | "unavailable" // 5xx / network — transient
  | "unreadable"; // anything else about this one file

export type OcrFailure = {
  kind: OcrFailureKind;
  /** Message shown on the file row. */
  message: string;
  /** True when continuing the batch would just repeat the same failure. */
  stopBatch: boolean;
  /** True when a later retry can reasonably succeed on its own. */
  retryable: boolean;
};

export const MANUAL_ENTRY_HINT =
  "Type the passenger, date and odometer readings by hand — the bill still saves normally.";

export function classifyOcrFailure(e: unknown): OcrFailure {
  const raw = e instanceof Error ? e.message : String(e ?? "");

  if (/\b402\b|credit|insufficient funds|top ?up/i.test(raw)) {
    return {
      kind: "credits",
      message: `Auto-read is out of AI credits, so nothing was read. ${MANUAL_ENTRY_HINT}`,
      stopBatch: true,
      retryable: false,
    };
  }
  if (/\b403\b|disabled|not allowed|limit reached|forbidden/i.test(raw)) {
    return {
      kind: "blocked",
      message: `Auto-read is turned off for this workspace. ${MANUAL_ENTRY_HINT}`,
      stopBatch: true,
      retryable: false,
    };
  }
  if (/too large|Too large/.test(raw)) {
    return {
      kind: "too_large",
      message:
        "File too large — use a smaller photo or a lower-resolution PDF (about 8 MB max), or enter the details by hand.",
      stopBatch: false,
      retryable: false,
    };
  }
  if (/\b429\b|rate limit|busy/i.test(raw)) {
    return {
      kind: "rate_limit",
      message: "Auto-read is busy right now — retry in a moment, or type the details in.",
      stopBatch: false,
      retryable: true,
    };
  }
  if (/\b5\d\d\b|network|fetch failed|timeout|unavailable/i.test(raw)) {
    return {
      kind: "unavailable",
      message: `Auto-read is temporarily unavailable — retry, or type the details in. ${raw ? `(${raw})` : ""}`.trim(),
      stopBatch: false,
      retryable: true,
    };
  }
  return {
    kind: "unreadable",
    message: raw
      ? `Couldn't read this file — ${raw}. ${MANUAL_ENTRY_HINT}`
      : `Couldn't read this file. ${MANUAL_ENTRY_HINT}`,
    stopBatch: false,
    retryable: true,
  };
}

/** Banner text shown once when a terminal condition halted auto-read. */
export function batchStopBanner(f: OcrFailure): string | null {
  if (!f.stopBatch) return null;
  return `${f.message} Every uploaded file is still stored and tracked — fill in the details and confirm as usual.`;
}
