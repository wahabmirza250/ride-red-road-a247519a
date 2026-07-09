
-- Notify admins when a new passenger profile signs up (fires from handle_new_user trigger chain)
CREATE OR REPLACE FUNCTION public.notify_admin_new_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  full_name text;
BEGIN
  full_name := trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''));
  IF full_name = '' THEN full_name := coalesce(NEW.email, 'Someone'); END IF;

  INSERT INTO public.admin_notifications (kind, title, body, url, data)
  VALUES (
    'signup',
    'New passenger signed up',
    full_name || COALESCE(' (' || NEW.email || ')', ''),
    '/passengers',
    jsonb_build_object('profile_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_new_signup ON public.profiles;
CREATE TRIGGER trg_notify_admin_new_signup
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_signup();

-- Notify admins when a driver changes online/offline
CREATE OR REPLACE FUNCTION public.notify_admin_driver_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  drv_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    INTO drv_name
    FROM public.profiles p
   WHERE p.id = NEW.user_id;
  IF drv_name IS NULL OR drv_name = '' THEN drv_name := 'Driver'; END IF;

  INSERT INTO public.admin_notifications (kind, title, body, url, data)
  VALUES (
    'driver_status',
    drv_name || ' is now ' || replace(NEW.status, '_', ' '),
    'Driver status changed from ' || COALESCE(OLD.status, 'unknown') || ' → ' || NEW.status,
    '/drivers',
    jsonb_build_object('driver_id', NEW.id, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_driver_status ON public.drivers;
CREATE TRIGGER trg_notify_admin_driver_status
AFTER UPDATE OF status ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_driver_status();
