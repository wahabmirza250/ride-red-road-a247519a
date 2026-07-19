
-- SECTION 1: Driver pay + shifts + gas receipts
DO $$ BEGIN
  CREATE TYPE public.driver_pay_type AS ENUM ('per_hour','commission');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS pay_type public.driver_pay_type NOT NULL DEFAULT 'per_hour',
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.driver_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  start_odometer integer,
  end_odometer integer,
  gps_miles numeric(10,2) NOT NULL DEFAULT 0,
  hourly_rate_snapshot numeric(10,2) NOT NULL DEFAULT 0,
  earnings numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_shifts TO authenticated;
GRANT ALL ON public.driver_shifts TO service_role;
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver reads own shifts" ON public.driver_shifts;
CREATE POLICY "Driver reads own shifts" ON public.driver_shifts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_shifts.driver_id AND d.user_id = auth.uid()) OR public.current_user_has_role('admin'));
DROP POLICY IF EXISTS "Admin writes shifts" ON public.driver_shifts;
CREATE POLICY "Admin writes shifts" ON public.driver_shifts FOR ALL TO authenticated
  USING (public.current_user_has_role('admin')) WITH CHECK (public.current_user_has_role('admin'));
CREATE INDEX IF NOT EXISTS driver_shifts_driver_idx ON public.driver_shifts(driver_id, clock_in_at DESC);

CREATE TABLE IF NOT EXISTS public.gas_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.driver_shifts(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL,
  gallons numeric(10,3),
  photo_path text NOT NULL,
  notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gas_receipts TO authenticated;
GRANT ALL ON public.gas_receipts TO service_role;
ALTER TABLE public.gas_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver manages own receipts" ON public.gas_receipts;
CREATE POLICY "Driver manages own receipts" ON public.gas_receipts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = gas_receipts.driver_id AND d.user_id = auth.uid()) OR public.current_user_has_role('admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = gas_receipts.driver_id AND d.user_id = auth.uid()) OR public.current_user_has_role('admin'));

-- SECTION 3: Trip documentation
ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS ride_purpose text,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_size integer NOT NULL DEFAULT 1;
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS ride_purpose text;

CREATE TABLE IF NOT EXISTS public.trip_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_path text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_media TO authenticated;
GRANT ALL ON public.trip_media TO service_role;
ALTER TABLE public.trip_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trip participants read media" ON public.trip_media;
CREATE POLICY "Trip participants read media" ON public.trip_media FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1 FROM public.trips t
      LEFT JOIN public.drivers d ON d.id = t.driver_id
      LEFT JOIN public.passengers p ON p.id = t.passenger_id
      WHERE t.id = trip_media.trip_id
        AND (d.user_id = auth.uid() OR p.user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Driver writes trip media" ON public.trip_media;
CREATE POLICY "Driver writes trip media" ON public.trip_media FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1 FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = trip_media.trip_id AND d.user_id = auth.uid()
    )
  );

-- SECTION 4: Trip stops (also used for group rides)
CREATE TABLE IF NOT EXISTS public.trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'stop',
  address text NOT NULL,
  lat double precision,
  lng double precision,
  passenger_name text,
  passenger_medicaid_id text,
  arrived_at timestamptz,
  departed_at timestamptz,
  added_by text NOT NULL DEFAULT 'driver',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_stops TO authenticated;
GRANT ALL ON public.trip_stops TO service_role;
ALTER TABLE public.trip_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trip participants read stops" ON public.trip_stops;
CREATE POLICY "Trip participants read stops" ON public.trip_stops FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1 FROM public.trips t
      LEFT JOIN public.drivers d ON d.id = t.driver_id
      LEFT JOIN public.passengers p ON p.id = t.passenger_id
      WHERE t.id = trip_stops.trip_id
        AND (d.user_id = auth.uid() OR p.user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Driver or admin writes stops" ON public.trip_stops;
CREATE POLICY "Driver or admin writes stops" ON public.trip_stops FOR ALL TO authenticated
  USING (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1 FROM public.trips t JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = trip_stops.trip_id AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1 FROM public.trips t JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = trip_stops.trip_id AND d.user_id = auth.uid()
    )
  );
CREATE INDEX IF NOT EXISTS trip_stops_trip_idx ON public.trip_stops(trip_id, sequence);

-- SECTION 5: Group ride passenger manifest
CREATE TABLE IF NOT EXISTS public.ride_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.ride_requests(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  medicaid_id text,
  pickup_address text NOT NULL,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_address text NOT NULL,
  dropoff_lat double precision,
  dropoff_lng double precision,
  pickup_sequence integer,
  dropoff_sequence integer,
  picked_up_at timestamptz,
  dropped_off_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_passengers TO authenticated;
GRANT ALL ON public.ride_passengers TO service_role;
ALTER TABLE public.ride_passengers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manages ride passengers" ON public.ride_passengers;
CREATE POLICY "Admin manages ride passengers" ON public.ride_passengers FOR ALL TO authenticated
  USING (public.current_user_has_role('admin')) WITH CHECK (public.current_user_has_role('admin'));
DROP POLICY IF EXISTS "Driver reads own group manifest" ON public.ride_passengers;
CREATE POLICY "Driver reads own group manifest" ON public.ride_passengers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = ride_passengers.trip_id AND d.user_id = auth.uid()
    )
  );
