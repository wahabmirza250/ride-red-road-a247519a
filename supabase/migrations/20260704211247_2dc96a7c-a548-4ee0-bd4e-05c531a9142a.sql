
-- Enums
DO $$ BEGIN
  CREATE TYPE public.nemt_trip_kind AS ENUM ('one_way','round_trip','group_tour');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.nemt_vehicle_type AS ENUM ('ground_ambulance','wheelchair_van','stretcher_van','taxi','ambulatory');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- medicaid_trips: extra columns for full form capture
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS trip_kind public.nemt_trip_kind DEFAULT 'one_way',
  ADD COLUMN IF NOT EXISTS vehicle_type public.nemt_vehicle_type,
  ADD COLUMN IF NOT EXISTS vehicle_plate TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_vin TEXT,
  ADD COLUMN IF NOT EXISTS escort_name TEXT,
  ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS signed_by_escort BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_id UUID;

CREATE INDEX IF NOT EXISTS medicaid_trips_group_idx ON public.medicaid_trips(group_id);

-- drivers: remember vehicle so we don't ask twice
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS default_vehicle_type public.nemt_vehicle_type,
  ADD COLUMN IF NOT EXISTS default_plate TEXT,
  ADD COLUMN IF NOT EXISTS default_vin TEXT;

-- Per-leg detail table (one row for one-way, two for round trip)
CREATE TABLE IF NOT EXISTS public.medicaid_trip_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicaid_trip_id UUID NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  leg_index SMALLINT NOT NULL CHECK (leg_index IN (1,2)),
  leg_date DATE NOT NULL,
  pickup_time TIME,
  pickup_odometer NUMERIC(10,1),
  pickup_address TEXT NOT NULL,
  dropoff_time TIME,
  dropoff_odometer NUMERIC(10,1),
  dropoff_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicaid_trip_id, leg_index)
);

CREATE INDEX IF NOT EXISTS medicaid_trip_legs_trip_idx ON public.medicaid_trip_legs(medicaid_trip_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicaid_trip_legs TO authenticated;
GRANT ALL ON public.medicaid_trip_legs TO service_role;

ALTER TABLE public.medicaid_trip_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers manage own legs"
  ON public.medicaid_trip_legs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medicaid_trips t
      WHERE t.id = medicaid_trip_legs.medicaid_trip_id
        AND (t.driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medicaid_trips t
      WHERE t.id = medicaid_trip_legs.medicaid_trip_id
        AND (t.driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE TRIGGER medicaid_trip_legs_set_updated_at
  BEFORE UPDATE ON public.medicaid_trip_legs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
