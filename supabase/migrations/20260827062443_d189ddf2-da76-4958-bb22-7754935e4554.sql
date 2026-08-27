-- 1. shifts: tenant comes from the driver.
CREATE OR REPLACE FUNCTION public.company_of_driver(_driver_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.company_id FROM public.drivers d WHERE d.id = _driver_id
$$;
REVOKE ALL ON FUNCTION public.company_of_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_of_driver(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS tenant_isolation ON public.shifts;
CREATE POLICY tenant_isolation ON public.shifts
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_driver(driver_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_driver(driver_id) = current_user_company_id());

-- 2. dispatch_events: give the log its own company_id, derived from whichever
-- parent reference the event carries.
ALTER TABLE public.dispatch_events ADD COLUMN IF NOT EXISTS company_id uuid;

CREATE OR REPLACE FUNCTION public.stamp_dispatch_event_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := COALESCE(
      public.company_of_ride_request(NEW.request_id),
      public.company_of_trip(NEW.trip_id),
      public.company_of_route(NEW.route_id),
      public.company_of_driver(NEW.driver_id),
      current_user_company_id()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_dispatch_event_company_trg ON public.dispatch_events;
CREATE TRIGGER stamp_dispatch_event_company_trg
BEFORE INSERT ON public.dispatch_events
FOR EACH ROW EXECUTE FUNCTION public.stamp_dispatch_event_company();

-- Back-fill existing log rows from their parent records.
UPDATE public.dispatch_events e
SET company_id = COALESCE(r.company_id, t.company_id, ro.company_id, d.company_id)
FROM (SELECT 1) _
LEFT JOIN public.ride_requests r ON false
LEFT JOIN public.trips t ON false
LEFT JOIN public.routes ro ON false
LEFT JOIN public.drivers d ON false
WHERE false;

UPDATE public.dispatch_events e
SET company_id = COALESCE(
  (SELECT r.company_id FROM public.ride_requests r WHERE r.id = e.request_id),
  (SELECT t.company_id FROM public.trips t WHERE t.id = e.trip_id),
  (SELECT ro.company_id FROM public.routes ro WHERE ro.id = e.route_id),
  (SELECT d.company_id FROM public.drivers d WHERE d.id = e.driver_id)
)
WHERE e.company_id IS NULL;

DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_events;
CREATE POLICY tenant_isolation ON public.dispatch_events
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  owner_unscoped()
  OR company_id = current_user_company_id()
  -- Legacy rows with no parent reference carry no tenant data at all.
  OR company_id IS NULL
)
WITH CHECK (owner_unscoped() OR company_id = current_user_company_id());