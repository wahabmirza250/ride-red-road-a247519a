
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS pickup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS ride_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_dropoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lat double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lng double precision;

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS last_4_ssn text;

ALTER TABLE public.riders
  DROP CONSTRAINT IF EXISTS riders_last_4_ssn_check;
ALTER TABLE public.riders
  ADD CONSTRAINT riders_last_4_ssn_check CHECK (last_4_ssn IS NULL OR last_4_ssn ~ '^[0-9]{4}$');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'medicaid_trips'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.medicaid_trips';
  END IF;
END $$;

ALTER TABLE public.medicaid_trips REPLICA IDENTITY FULL;
