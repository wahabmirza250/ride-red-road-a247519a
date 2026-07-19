CREATE OR REPLACE FUNCTION public.notify_admin_driver_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    drv_name || ' is now ' || replace(NEW.status::text, '_', ' '),
    'Driver status changed from ' || COALESCE(OLD.status::text, 'unknown') || ' → ' || NEW.status::text,
    '/drivers',
    jsonb_build_object('driver_id', NEW.id, 'status', NEW.status::text)
  );
  RETURN NEW;
END;
$function$;