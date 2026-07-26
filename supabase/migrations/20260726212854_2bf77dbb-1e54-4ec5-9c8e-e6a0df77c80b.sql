-- 1) Self-signup can NEVER pick a privileged role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Every self-signup is a passenger. Privileged roles (driver/dispatch/admin)
  -- are granted only by an admin afterwards via the service role.
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'passenger')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'SELF-' || substr(NEW.id::text, 1, 8)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Explicit: only admins may write roles. (No write policy existed; make it explicit.)
DROP POLICY IF EXISTS "user_roles admin write" ON public.user_roles;
CREATE POLICY "user_roles admin write" ON public.user_roles
FOR ALL TO authenticated
USING (public.current_user_has_role('admin'))
WITH CHECK (public.current_user_has_role('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Defence in depth: block any non-service-role attempt to self-grant a privileged role.
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF current_setting('role', true) = 'service_role' OR session_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);  -- trigger-driven inserts (handle_new_user)
  END IF;
  IF _role IN ('driver', 'dispatch', 'admin') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS guard_user_roles_write ON public.user_roles;
CREATE TRIGGER guard_user_roles_write
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_user_roles_write();

-- 3) Trips: passengers may only create their own pending, unassigned trips.
DROP POLICY IF EXISTS "trips passenger insert pending" ON public.trips;
CREATE POLICY "trips passenger insert pending" ON public.trips
FOR INSERT TO authenticated
WITH CHECK (
  status = 'scheduled'
  AND driver_id IS NULL
  AND passenger_id IN (SELECT p.id FROM public.passengers p WHERE p.user_id = auth.uid())
);

-- 4) Drivers may only advance their own assigned trips, on progress columns.
CREATE OR REPLACE FUNCTION public.guard_trip_driver_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR auth.uid() IS NULL
     OR public.current_user_has_role('admin')
     OR public.current_user_is_dispatch() THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.id = OLD.driver_id AND d.user_id = auth.uid()
  ) THEN
    RETURN NEW; -- not the assigned driver; RLS handles the rest
  END IF;

  -- Assigned driver: driver_id is immutable, and only progress fields may change.
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'Drivers cannot reassign a trip';
  END IF;

  IF (NEW.passenger_id, NEW.pickup_address, NEW.pickup_lat, NEW.pickup_lng,
      NEW.dropoff_address, NEW.dropoff_lat, NEW.dropoff_lng,
      NEW.scheduled_pickup_time, NEW.estimated_fare, NEW.billing_status,
      NEW.hcpf_claim_number, NEW.assignment_type, NEW.passenger_rating)
     IS DISTINCT FROM
     (OLD.passenger_id, OLD.pickup_address, OLD.pickup_lat, OLD.pickup_lng,
      OLD.dropoff_address, OLD.dropoff_lat, OLD.dropoff_lng,
      OLD.scheduled_pickup_time, OLD.estimated_fare, OLD.billing_status,
      OLD.hcpf_claim_number, OLD.assignment_type, OLD.passenger_rating)
  THEN
    RAISE EXCEPTION 'Drivers may only update trip progress fields';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_trip_driver_update ON public.trips;
CREATE TRIGGER guard_trip_driver_update
BEFORE UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.guard_trip_driver_update();