/**
 * Shared, clamped env reader for the submission queue and the robot fleet.
 * Kept in its own module so the fleet layer does not have to import the queue
 * worker (which imports the robot helpers) just to read a number.
 */
export function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
