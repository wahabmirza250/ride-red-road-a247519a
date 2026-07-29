CREATE OR REPLACE FUNCTION public.requests_on_route(_ids uuid[])
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rs.request_id
    FROM public.route_stops rs
   WHERE rs.request_id = ANY(_ids)
$$;

REVOKE ALL ON FUNCTION public.requests_on_route(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requests_on_route(uuid[]) TO authenticated, service_role;