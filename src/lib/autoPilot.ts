/**
 * AUTO PILOT — press once, the whole day's billing runs itself.
 *
 * Auto Pilot is NOT a different submission path. It repeatedly calls the exact
 * same safe path as "Submit Claims" (preflight → durable idempotent enqueue →
 * leased dispatch → reconciliation), just without a human clicking each time.
 *
 * It feeds the queue in BOUNDED WAVES: it keeps at most `AUTO_PILOT_WAVE` bills
 * of the run in flight (queued + sending) and tops the wave up as bills reach a
 * terminal outcome, until nothing eligible is left. A wave is a MAXIMUM, so a
 * tail of 7 goes as 7. Real portal concurrency is unchanged and still decided
 * by the per-account cap, the fleet capacity and one live claim per rider.
 *
 * Stopping only stops FEEDING. Bills already sent to the portal are never
 * cancelled — an uncertain outcome must always be resolved, never abandoned.
 */

export const AUTO_PILOT_WAVE = 20;

export type AutoPilotRunStatus = "running" | "stopped" | "finished";

export type AutoPilotState = {
  running: boolean;
  runId: string | null;
  status: AutoPilotRunStatus | null;
  /** Bills this run has already put on the queue. */
  enqueued: number;
  /** Bills still eligible and not yet queued by this run. */
  remaining: number;
  /** Queued + sending right now (whole company lane). */
  inFlight: number;
  startedAt: string | null;
  lastFeedAt: string | null;
  label: string;
};

/** How many bills the next wave may add. Never negative, never over the cap. */
export function waveRoom(inFlight: number, wave = AUTO_PILOT_WAVE): number {
  const cap = Math.max(1, Math.floor(wave));
  return Math.max(0, cap - Math.max(0, Math.floor(inFlight)));
}

/** How many bills the next feed actually takes: the wave room, or all that remain. */
export function nextFeedSize(remaining: number, inFlight: number, wave = AUTO_PILOT_WAVE): number {
  return Math.min(Math.max(0, Math.floor(remaining)), waveRoom(inFlight, wave));
}

/** A run is done once nothing is eligible and nothing of it is still moving. */
export function isRunComplete(remaining: number, inFlight: number): boolean {
  return remaining <= 0 && inFlight <= 0;
}

export function autoPilotLabel(s: {
  running: boolean;
  remaining: number;
  inFlight: number;
  enqueued: number;
}): string {
  if (!s.running) {
    return s.remaining > 0
      ? `${s.remaining} bill${s.remaining === 1 ? "" : "s"} ready — start Auto Pilot`
      : "Nothing ready to send";
  }
  if (s.remaining > 0)
    return `Auto Pilot running — ${s.inFlight} sending, ${s.remaining} to go`;
  if (s.inFlight > 0) return `Auto Pilot finishing — ${s.inFlight} still sending`;
  return "Auto Pilot finished";
}

/**
 * Stopping is only allowed to affect work that has NOT been handed to the
 * portal. Anything sending (or awaiting verification) keeps going.
 */
export const canStopSafely = (status: string | null | undefined) =>
  String(status ?? "") === "queued";

/**
 * WAVE FILL PLANNER (pure).
 *
 * A wave is "20 bills actually on the queue", not "20 bills looked at". Some
 * eligible bills are legitimately refused by the safe submit path (awaiting
 * manual HCPF verification, missing data, already queued). If those sit at the
 * head of the list, a single-pass feed spends the whole wave on them and the
 * queue never fills — the exact head-of-line stall this solves.
 *
 * So the feed keeps taking the NEXT untried candidates until the wave room is
 * genuinely filled, the eligible list is exhausted, or the round budget runs
 * out. It never raises portal concurrency: everything extra simply waits in
 * `queued`.
 */
export async function fillWave(opts: {
  eligible: string[];
  inFlight: number;
  wave?: number;
  maxRounds?: number;
  submit: (ids: string[]) => Promise<{ queued: number; skipped?: number }>;
}): Promise<{ queued: number; attempted: number; rounds: number }> {
  const wave = opts.wave ?? AUTO_PILOT_WAVE;
  const maxRounds = Math.max(1, opts.maxRounds ?? 5);
  let queued = 0;
  let attempted = 0;
  let rounds = 0;
  let cursor = 0;

  while (rounds < maxRounds && cursor < opts.eligible.length) {
    const room = waveRoom(opts.inFlight + queued, wave);
    if (room <= 0) break;
    const batch = opts.eligible.slice(cursor, cursor + room);
    if (batch.length === 0) break;
    cursor += batch.length;
    attempted += batch.length;
    rounds += 1;
    const res = await opts.submit(batch);
    queued += Math.max(0, res.queued);
  }
  return { queued, attempted, rounds };
}
