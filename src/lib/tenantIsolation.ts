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
};

/** COALESCE(company_of_trip(...), company_of_route(...), company_of_ride_request(...)) */
export function resolveRowCompanyId(row: ChildRowTenant): string | null {
  return row.tripCompanyId ?? row.routeCompanyId ?? row.requestCompanyId ?? null;
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

/** service_role bypasses RLS: internal worker flows keep full access. */
export function serviceRoleBypassesTenantPolicy(): true {
  return true;
}
