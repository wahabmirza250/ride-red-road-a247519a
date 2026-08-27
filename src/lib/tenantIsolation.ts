/**
 * TENANT ISOLATION FOR CHILD ROW TABLES (ride_passengers, route_stops, trip_stops).
 *
 * These tables carry rider PII (name, phone, Medicaid ID, addresses) but have no
 * company_id of their own — their tenant is the parent trip / route / ride request.
 * The database enforces this with RESTRICTIVE `tenant_isolation` policies granted
 * `TO authenticated`, so:
 *
 *   - every signed-in caller (dispatch, admin, driver, biller) is additionally
 *     constrained to their own company, on read AND write;
 *   - `service_role` (internal workers, robot polling, queue ticks) bypasses RLS
 *     entirely and is unaffected;
 *   - platform owners keep their existing cross-company view via owner_unscoped().
 *
 * This module mirrors that SQL predicate so it can be regression-tested without a
 * live database. It is the reference definition — keep it in sync with the
 * migration if the policy ever changes.
 */

export type TenantContext = {
  /** company_id of the signed-in user (current_user_company_id()). */
  userCompanyId: string | null;
  /** owner_unscoped(): platform owner viewing across companies. */
  ownerUnscoped?: boolean;
};

export type ChildRowTenant = {
  /** company_of_trip(trip_id) */
  tripCompanyId?: string | null;
  /** company_of_route(route_id) */
  routeCompanyId?: string | null;
  /** company_of_ride_request(request_id) */
  requestCompanyId?: string | null;
  /** company_of_driver(driver_id) */
  driverCompanyId?: string | null;
};


/** COALESCE over every parent lookup used by the restrictive policies. */
export function resolveRowCompanyId(row: ChildRowTenant): string | null {
  return (
    row.tripCompanyId ?? row.routeCompanyId ?? row.requestCompanyId ?? row.driverCompanyId ?? null
  );
}

/**
 * The restrictive policy predicate, used for both USING and WITH CHECK.
 * An unresolvable parent (null company) is denied for ordinary callers.
 */
export function tenantPolicyAllows(ctx: TenantContext, row: ChildRowTenant): boolean {
  if (ctx.ownerUnscoped) return true;
  const rowCompany = resolveRowCompanyId(row);
  if (!rowCompany || !ctx.userCompanyId) return false;
  return rowCompany === ctx.userCompanyId;
}

/**
 * dispatch_events carries its own stamped company_id. Legacy rows that predate
 * the column and reference no parent at all carry no tenant data, so they stay
 * readable; everything else is company-scoped. Writes are always scoped.
 */
export function dispatchEventPolicyAllows(
  ctx: TenantContext,
  event: { companyId: string | null },
  mode: "read" | "write" = "read",
): boolean {
  if (ctx.ownerUnscoped) return true;
  if (event.companyId === null) return mode === "read";
  return !!ctx.userCompanyId && event.companyId === ctx.userCompanyId;
}

/** company_id stamped on insert from whichever parent reference the event has. */
export function resolveDispatchEventCompanyId(
  event: ChildRowTenant,
  actorCompanyId: string | null,
): string | null {
  return (
    event.requestCompanyId ??
    event.tripCompanyId ??
    event.routeCompanyId ??
    event.driverCompanyId ??
    actorCompanyId ??
    null
  );
}

/** service_role bypasses RLS: internal worker flows keep full access. */
export function serviceRoleBypassesTenantPolicy(): true {
  return true;
}


/**
 * ride_requests access. `ride_requests.passenger_id` is a FK to auth.users(id),
 * so the passenger policy predicate `passenger_id = auth.uid()` compares the
 * correct column: a passenger only ever sees their own requests. Staff roles
 * (admin / dispatch) keep their existing access, and the RESTRICTIVE
 * `tenant_isolation` policy on the table additionally confines every signed-in
 * caller to their own company_id.
 */
export type RideRequestRow = { passengerUserId: string | null; companyId: string | null };
export type RideRequestActor = TenantContext & {
  userId: string;
  roles?: ReadonlyArray<"passenger" | "admin" | "dispatch" | "driver">;
};

export function rideRequestPolicyAllows(actor: RideRequestActor, row: RideRequestRow): boolean {
  // RESTRICTIVE tenant_isolation runs first for everyone.
  if (!actor.ownerUnscoped) {
    if (!row.companyId || !actor.userCompanyId) return false;
    if (row.companyId !== actor.userCompanyId) return false;
  }
  const roles = actor.roles ?? [];
  if (roles.includes("admin") || roles.includes("dispatch")) return true;
  // Passenger permissive policy: own rows only, matched on the auth user id.
  return !!row.passengerUserId && row.passengerUserId === actor.userId;
}

/**
 * billing_settings holds per-company billing configuration (e.g. default portal).
 * Admin / biller reads are additionally confined to their own company by the
 * RESTRICTIVE tenant_isolation policy.
 */
export function billingSettingsPolicyAllows(
  ctx: TenantContext,
  row: { companyId: string | null },
): boolean {
  if (ctx.ownerUnscoped) return true;
  if (!row.companyId || !ctx.userCompanyId) return false;
  return row.companyId === ctx.userCompanyId;
}
