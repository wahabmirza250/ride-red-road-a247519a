export const LOCATION_FRESH_MS = 90_000;
export function locationState(
  driver:
    | {
        current_lat?: number | null;
        current_lng?: number | null;
        last_location_at?: string | null;
        status?: string;
      }
    | null
    | undefined,
  now = Date.now(),
) {
  if (!driver || driver.status === "offline") return "Offline";
  if (driver.current_lat == null || driver.current_lng == null || !driver.last_location_at)
    return "No location";
  const age = now - Date.parse(driver.last_location_at);
  return Number.isFinite(age) && age >= -30_000 && age <= LOCATION_FRESH_MS ? "Live" : "Stale";
}

/** datetime-local represents the operator's local clock, never a sliced UTC string. */
export function localDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function localInputToISOString(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTimeInput(date) !== value)
    throw new Error(
      "Choose a valid local pickup time. This time may fall in a daylight-saving clock change.",
    );
  return date.toISOString();
}
