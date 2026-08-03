
-- 1. companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  url_slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.companies TO authenticated, anon;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.companies (id, name, url_slug)
VALUES ('11111111-2222-4333-8444-555555555555', 'Walla Investment LLC', 'walla');

-- 2. company_id columns
ALTER TABLE public.profiles                  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles                ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.drivers                   ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.passengers                ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.riders                    ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.trips                     ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.ride_requests             ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.medicaid_trips            ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.billing_rate_settings     ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.billing_records           ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.routes                    ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.driver_shifts             ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.gas_receipts              ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- 3. backfill everything to the existing company
DO $$
DECLARE c uuid := '11111111-2222-4333-8444-555555555555';
BEGIN
  UPDATE public.profiles              SET company_id = c WHERE company_id IS NULL;
  UPDATE public.user_roles            SET company_id = c WHERE company_id IS NULL;
  UPDATE public.drivers               SET company_id = c WHERE company_id IS NULL;
  UPDATE public.passengers            SET company_id = c WHERE company_id IS NULL;
  UPDATE public.riders                SET company_id = c WHERE company_id IS NULL;
  UPDATE public.trips                 SET company_id = c WHERE company_id IS NULL;
  UPDATE public.ride_requests         SET company_id = c WHERE company_id IS NULL;
  UPDATE public.medicaid_trips        SET company_id = c WHERE company_id IS NULL;
  UPDATE public.billing_rate_settings SET company_id = c WHERE company_id IS NULL;
  UPDATE public.billing_records       SET company_id = c WHERE company_id IS NULL;
  UPDATE public.routes                SET company_id = c WHERE company_id IS NULL;
  UPDATE public.driver_shifts         SET company_id = c WHERE company_id IS NULL;
  UPDATE public.gas_receipts          SET company_id = c WHERE company_id IS NULL;
  UPDATE public.state_portal_credentials SET company_id = c WHERE company_id IS NULL;
  UPDATE public.billing_settings      SET company_id = c WHERE company_id IS NULL;
END $$;

CREATE INDEX idx_profiles_company        ON public.profiles(company_id);
CREATE INDEX idx_user_roles_company      ON public.user_roles(company_id);
CREATE INDEX idx_drivers_company         ON public.drivers(company_id);
CREATE INDEX idx_passengers_company      ON public.passengers(company_id);
CREATE INDEX idx_riders_company          ON public.riders(company_id);
CREATE INDEX idx_trips_company           ON public.trips(company_id);
CREATE INDEX idx_ride_requests_company   ON public.ride_requests(company_id);
CREATE INDEX idx_medicaid_trips_company  ON public.medicaid_trips(company_id);
CREATE INDEX idx_routes_company          ON public.routes(company_id);

-- 4. helper functions
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'platform_owner'
  )
$$;

CREATE OR REPLACE FUNCTION public.company_is_active(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status = 'active' FROM public.companies WHERE id = _company_id), false)
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_company_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_company_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_is_active(uuid) TO authenticated, service_role;

-- 5. companies visibility
CREATE POLICY "Companies are readable by their members"
  ON public.companies FOR SELECT TO authenticated
  USING (id = public.current_user_company_id() OR public.is_platform_owner());
CREATE POLICY "Platform owner manages companies"
  ON public.companies FOR ALL TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());

-- 6. auto-stamp company_id on insert
CREATE OR REPLACE FUNCTION public.stamp_company_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_user_company_id();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','drivers','passengers','riders','trips','ride_requests',
                           'medicaid_trips','billing_rate_settings','billing_records','routes',
                           'driver_shifts','gas_receipts']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_stamp_company BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id()',
      t, t);
  END LOOP;
END $$;

-- 7. hard tenant isolation: restrictive policies AND-ed with all existing policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['drivers','passengers','riders','trips','ride_requests','medicaid_trips',
                           'billing_rate_settings','billing_records','routes','driver_shifts',
                           'gas_receipts','state_portal_credentials','user_roles']
  LOOP
    EXECUTE format($f$
      CREATE POLICY "tenant_isolation" ON public.%I AS RESTRICTIVE TO authenticated
      USING (public.is_platform_owner() OR company_id = public.current_user_company_id())
      WITH CHECK (public.is_platform_owner() OR company_id = public.current_user_company_id())
    $f$, t);
  END LOOP;
END $$;

CREATE POLICY "tenant_isolation" ON public.profiles AS RESTRICTIVE TO authenticated
  USING (public.is_platform_owner() OR company_id = public.current_user_company_id() OR id = auth.uid())
  WITH CHECK (public.is_platform_owner() OR company_id = public.current_user_company_id() OR id = auth.uid());

-- 8. new signups inherit the company they signed up through
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
BEGIN
  BEGIN
    _company := NULLIF(NEW.raw_user_meta_data->>'company_id','')::uuid;
  EXCEPTION WHEN others THEN
    _company := NULL;
  END;
  IF _company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = _company) THEN
    _company := '11111111-2222-4333-8444-555555555555';
  END IF;

  INSERT INTO public.profiles (id, email, first_name, last_name, phone, company_id)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'first_name',''),
          COALESCE(NEW.raw_user_meta_data->>'last_name',''),
          COALESCE(NEW.raw_user_meta_data->>'phone',''),
          _company)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role, company_id) VALUES (NEW.id, 'passenger', _company)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id, company_id)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'first_name',''),
          COALESCE(NEW.raw_user_meta_data->>'last_name',''),
          NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'phone',''),
          'SELF-' || substr(NEW.id::text,1,8),
          _company)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- 9. nobody can self-grant platform_owner
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role = 'platform_owner'
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
  IF _role IN ('driver','dispatch','admin') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
