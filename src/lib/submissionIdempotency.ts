/**
 * IDEMPOTENCY KEYS FOR PORTAL SUBMISSIONS (pure, client-safe).
 *
 * One immutable key identifies one *submission attempt intent* for a bill:
 *
 *     <account key> : <trip id> : <service date> : v<version>
 *
 * The key is written on the billing record when it is enqueued and is protected
 * by a unique index, so:
 *   - a double click, a page refresh, two open tabs, or two billers selecting
 *     the same bill all resolve to the SAME queued/active job;
 *   - a deliberate, acknowledged resubmission bumps `version` and therefore
 *     gets its own key — it is a new attempt, not a duplicate of the old one.
 */

export type IdempotencyInput = {
  accountKey: string | null | undefined;
  companyId: string | null | undefined;
  tripId: string;
  serviceDate: string | null | undefined;
  /** Submission version; bumped only by an explicit acknowledged resubmit. */
  version?: number;
};

/** `YYYY-MM-DD` of a timestamp, or `nodate` when the bill has none yet. */
export function serviceDatePart(serviceDate: string | null | undefined): string {
  const raw = String(serviceDate ?? "").trim();
  if (!raw) return "nodate";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10).replace(/[^0-9-]/g, "") || "nodate";
  return d.toISOString().slice(0, 10);
}

export function buildIdempotencyKey(input: IdempotencyInput): string {
  const account = String(input.accountKey ?? `company:${input.companyId ?? "none"}`).trim();
  const version = Math.max(1, Math.floor(input.version ?? 1));
  return [account, input.tripId, serviceDatePart(input.serviceDate), `v${version}`].join("|");
}

/** Version encoded in a key, or 1 when the key is absent/unparseable. */
export function versionOfKey(key: string | null | undefined): number {
  const m = /\|v(\d+)$/.exec(String(key ?? ""));
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** The key a fresh, acknowledged resubmission of `previous` should use. */
export function nextVersionKey(previous: string | null | undefined, input: IdempotencyInput): string {
  return buildIdempotencyKey({ ...input, version: versionOfKey(previous) + 1 });
}
