-- Security-definer lookups so the restrictive policies below can resolve the
-- parent record's company without being blocked by that table's own RLS.
CREATE OR REPLACE FUNCTION public.company_of_trip(_trip_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.company_id FROM public.trips t WHERE t.id = _trip_id
$$;

CREATE OR REPLACE FUNCTION public.company_of_route(_route_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.company_id FROM public.routes r WHERE r.id = _route_id
$$;

CREATE OR REPLACE FUNCTION public.company_of_ride_request(_request_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.company_id FROM public.ride_requests r WHERE r.id = _request_id
$$;

REVOKE ALL ON FUNCTION public.company_of_trip(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_of_route(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_of_ride_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_of_trip(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_of_route(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_of_ride_request(uuid) TO authenticated, service_role;

-- Restrictive tenant isolation, matching the existing pattern used on
-- trips/routes/billing_records. service_role bypasses RLS entirely, so the
-- internal worker flows are unaffected.
DROP POLICY IF EXISTS tenant_isolation ON public.trip_stops;
CREATE POLICY tenant_isolation ON public.trip_stops
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_trip(trip_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_trip(trip_id) = current_user_company_id());

DROP POLICY IF EXISTS tenant_isolation ON public.route_stops;
CREATE POLICY tenant_isolation ON public.route_stops
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_route(route_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_route(route_id) = current_user_company_id());

DROP POLICY IF EXISTS tenant_isolation ON public.ride_passengers;
CREATE POLICY tenant_isolation ON public.ride_passengers
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  owner_unscoped()
  OR COALESCE(public.company_of_trip(trip_id), public.company_of_ride_request(request_id))
     = current_user_company_id()
)
WITH CHECK (
  owner_unscoped()
  OR COALESCE(public.company_of_trip(trip_id), public.company_of_ride_request(request_id))
     = current_user_company_id()
);