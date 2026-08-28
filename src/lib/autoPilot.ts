/**
 * AUTO PILOT — who releases the next wave of a batch.
 *
 * Auto Pilot ON  : the scheduler releases the next wave (max 20, or all that
 *                  remain) as soon as the current wave reaches terminal
 *                  outcomes. Nothing else changes.
 * Auto Pilot OFF : held rows simply keep waiting. Items already released or
 *                  submitting are never cancelled, paused or altered — only
 *                  the promotion of FUTURE-wave rows stops. A biller can then
 *                  release the next up-to-20 manually.
 *
 * Both the per-batch flag and the company default live in Postgres, so a
 * refresh, a new tab or a server restart changes nothing.
 */

/** Company-level fallback when a batch has no explicit preference. */
export const AUTO_PILOT_FALLBACK = true;

export function resolveAutoPilotDefault(companyPreference: unknown): boolean {
  if (companyPreference === true || companyPreference === false) return companyPreference;
  return AUTO_PILOT_FALLBACK;
}

/** Should the scheduler promote the next wave of this batch right now? */
export function shouldAutoPromote(batch: { auto_pilot?: boolean | null } | null | undefined): boolean {
  return batch?.auto_pilot !== false;
}

export function autoPilotStatusLabel(on: boolean, waiting = 0): string {
  if (on) return "Auto Pilot ON — next wave starts automatically";
  return waiting > 0
    ? `OFF — waiting after current wave (${waiting} held)`
    : "OFF — waiting after current wave";
}
