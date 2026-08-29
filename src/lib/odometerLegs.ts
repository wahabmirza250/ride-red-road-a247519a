/**
 * ODOMETER SOURCE OF TRUTH (pure, shared by server + tests).
 *
 * The submission preflight bills miles from `medicaid_trip_legs` whenever any
 * leg row exists, and only falls back to `medicaid_trips.odometer_start/end`
 * when there are none. A correction that wrote the trip columns alone
 * therefore left a "0 billable miles" bill stuck in Needs Attention forever —
 * the biller fixed the numbers and nothing changed.
 *
 * This planner decides what a corrected odometer must do to the legs:
 *   - no legs      -> nothing to write; the trip columns ARE the source
 *   - exactly one  -> update that leg to match the correction
 *   - several legs -> never guess how to split a multi-leg trip; report it so
 *                     the biller is told plainly instead of silently failing
 */
export type TripLeg = { id: string; leg_index?: number | null };

export type LegSyncPlan =
  | { action: "none" }
  | { action: "update"; legId: string; pickup_odometer: number; dropoff_odometer: number }
  | { action: "manual"; reason: string };

export function planLegSync(
  legs: TripLeg[] | null | undefined,
  odometer: { start: number; end: number },
): LegSyncPlan {
  const rows = legs ?? [];
  if (rows.length === 0) return { action: "none" };
  if (rows.length === 1) {
    return {
      action: "update",
      legId: rows[0]!.id,
      pickup_odometer: odometer.start,
      dropoff_odometer: odometer.end,
    };
  }
  return {
    action: "manual",
    reason:
      "This trip is billed from several odometer legs, so the corrected start/end could not be applied automatically. Edit the individual legs on the trip.",
  };
}
