-- 1. Signup trigger: never create a passenger record for staff accounts.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
  _role text;
BEGIN
  BEGIN
    _company := NULLIF(NEW.raw_user_meta_data->>'company_id','')::uuid;
  EXCEPTION WHEN others THEN
    _company := NULL;
  END;
  IF _company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = _company) THEN
    _company := '11111111-2222-4333-8444-555555555555';
  END IF;

  _role := lower(coalesce(NEW.raw_user_meta_data->>'role',''));

  INSERT INTO public.profiles (id, email, first_name, last_name, phone, company_id)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'first_name',''),
          COALESCE(NEW.raw_user_meta_data->>'last_name',''),
          COALESCE(NEW.raw_user_meta_data->>'phone',''),
          _company)
  ON CONFLICT (id) DO NOTHING;

  IF _role IN ('driver','admin','dispatch','billing','admin_biller','platform_owner') THEN
    -- Staff account: assign its real role only, and never create a passenger row.
    INSERT INTO public.user_roles (user_id, role, company_id)
    VALUES (NEW.id, _role::public.app_role, _company)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN NEW;
  END IF;

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

-- 2. Keep (but hide) staff rows that already carry real trip history.
UPDATE public.passengers p
SET is_active = false
WHERE p.user_id IN (SELECT user_id FROM public.user_roles WHERE role <> 'passenger')
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.passenger_id = p.id);

-- 3. Delete staff-identity passenger rows with no data attached to them.
DELETE FROM public.passengers p
WHERE p.user_id IN (SELECT user_id FROM public.user_roles WHERE role <> 'passenger')
  AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_entries c WHERE c.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_winners w WHERE w.passenger_id = p.id);
