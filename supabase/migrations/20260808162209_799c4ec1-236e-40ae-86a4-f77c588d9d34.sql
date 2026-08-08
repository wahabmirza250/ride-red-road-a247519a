ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'billing';

CREATE OR REPLACE FUNCTION public.current_user_can_bill()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','billing')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_billing()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'billing'
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_user_can_bill() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_billing() TO authenticated;

-- billing_records
CREATE POLICY "billing_records billing staff all" ON public.billing_records
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- medicaid_trips
CREATE POLICY "medicaid_trips billing read" ON public.medicaid_trips
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "medicaid_trips billing insert" ON public.medicaid_trips
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_bill());
CREATE POLICY "medicaid_trips billing update" ON public.medicaid_trips
  FOR UPDATE TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- medicaid_trip_legs
CREATE POLICY "medicaid_trip_legs billing all" ON public.medicaid_trip_legs
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- riders
CREATE POLICY "riders billing read" ON public.riders
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "riders billing insert" ON public.riders
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_bill());
CREATE POLICY "riders billing update" ON public.riders
  FOR UPDATE TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- rate + settings (read only)
CREATE POLICY "billing_rate_settings billing read" ON public.billing_rate_settings
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "billing_settings billing read" ON public.billing_settings
  FOR SELECT TO authenticated USING (public.current_user_can_bill());

-- audit log
CREATE POLICY "billing_audit_log billing all" ON public.billing_audit_log
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- profiles: billers need driver names inside their company
CREATE POLICY "profiles billing read" ON public.profiles
  FOR SELECT TO authenticated USING (public.current_user_can_bill());

-- storage: proof-of-service documents
CREATE POLICY "Billers manage state pdfs" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'state-pdfs' AND public.current_user_can_bill())
  WITH CHECK (bucket_id = 'state-pdfs' AND public.current_user_can_bill());

CREATE POLICY "Billers read signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND public.current_user_can_bill());

-- only admins may grant/revoke the billing role
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role::text = 'platform_owner'
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'platform_owner may only be granted directly by the platform';
  END IF;
  IF current_setting('role', true) = 'service_role' OR session_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF _role::text IN ('driver','dispatch','admin','billing') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;