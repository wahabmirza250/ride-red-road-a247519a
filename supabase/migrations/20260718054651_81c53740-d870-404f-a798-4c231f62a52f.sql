
DROP TRIGGER IF EXISTS trg_notify_admin_driver_status ON public.drivers;

ALTER TABLE public.drivers ALTER COLUMN status DROP DEFAULT;
ALTER TYPE public.driver_status RENAME TO driver_status_old;
CREATE TYPE public.driver_status AS ENUM ('available', 'busy', 'offline');
ALTER TABLE public.drivers
  ALTER COLUMN status TYPE public.driver_status
  USING (
    CASE status::text
      WHEN 'on_trip' THEN 'busy'
      ELSE status::text
    END
  )::public.driver_status;
ALTER TABLE public.drivers ALTER COLUMN status SET DEFAULT 'offline'::public.driver_status;
DROP TYPE public.driver_status_old;

CREATE TRIGGER trg_notify_admin_driver_status
AFTER UPDATE OF status ON public.drivers
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_driver_status();

ALTER TABLE public.drivers DROP COLUMN IF EXISTS is_online;

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS declined_driver_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS ride_requests_status_offer_idx
  ON public.ride_requests (status, offer_expires_at);

CREATE OR REPLACE FUNCTION public.release_driver_on_trip_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers
       SET status = 'available'
     WHERE id = NEW.driver_id
       AND status = 'busy';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_driver_on_trip_end ON public.trips;
CREATE TRIGGER trg_release_driver_on_trip_end
AFTER UPDATE OF status ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.release_driver_on_trip_end();

DROP POLICY IF EXISTS "Users create their own ride requests" ON public.ride_requests;
CREATE POLICY "Users create their own ride requests"
  ON public.ride_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (passenger_id = auth.uid());

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE public.drivers REPLICA IDENTITY FULL;
ALTER TABLE public.ride_requests REPLICA IDENTITY FULL;
