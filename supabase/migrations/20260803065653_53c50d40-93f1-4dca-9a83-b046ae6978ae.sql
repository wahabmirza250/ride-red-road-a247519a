DO $$
DECLARE _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = 'wahabmirza250@gmail.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No auth user with email wahabmirza250@gmail.com';
  END IF;
  ALTER TABLE public.user_roles DISABLE TRIGGER guard_user_roles_write;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'platform_owner')
  ON CONFLICT (user_id, role) DO NOTHING;
  ALTER TABLE public.user_roles ENABLE TRIGGER guard_user_roles_write;
END $$;