
-- Riders (Medicaid passenger profiles)
CREATE TABLE public.riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  medicaid_id TEXT NOT NULL UNIQUE,
  dob DATE,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX riders_name_idx ON public.riders USING gin (to_tsvector('simple', full_name));
CREATE INDEX riders_medicaid_idx ON public.riders (medicaid_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.riders TO authenticated;
GRANT ALL ON public.riders TO service_role;

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers and admins can read riders"
  ON public.riders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'driver'));

CREATE POLICY "Drivers and admins can insert riders"
  ON public.riders FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'driver'));

CREATE POLICY "Drivers can update riders they created; admins any"
  ON public.riders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR created_by = auth.uid());

CREATE POLICY "Admins can delete riders"
  ON public.riders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_riders_updated_at
  BEFORE UPDATE ON public.riders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Medicaid trips (Colorado state form entries)
CREATE TYPE public.medicaid_trip_status AS ENUM ('pending_review', 'approved', 'rejected', 'submitted', 'needs_fix');

CREATE TABLE public.medicaid_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  pickup_at TIMESTAMPTZ NOT NULL,
  pickup_address TEXT NOT NULL,
  dropoff_address TEXT NOT NULL,
  odometer_start NUMERIC(10,1) NOT NULL,
  odometer_end NUMERIC(10,1) NOT NULL,
  miles NUMERIC(10,1) NOT NULL,
  signature_path TEXT,
  signature_name TEXT,
  status public.medicaid_trip_status NOT NULL DEFAULT 'pending_review',
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  state_pdf_path TEXT,
  submitted_confirmation TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX medicaid_trips_driver_idx ON public.medicaid_trips (driver_id, pickup_at DESC);
CREATE INDEX medicaid_trips_status_idx ON public.medicaid_trips (status, pickup_at DESC);
CREATE INDEX medicaid_trips_rider_idx ON public.medicaid_trips (rider_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicaid_trips TO authenticated;
GRANT ALL ON public.medicaid_trips TO service_role;

ALTER TABLE public.medicaid_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers see own; admins see all"
  ON public.medicaid_trips FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR driver_id = auth.uid());

CREATE POLICY "Drivers create own trips"
  ON public.medicaid_trips FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'admin'))
    AND driver_id = auth.uid()
  );

CREATE POLICY "Drivers edit own pending; admins any"
  ON public.medicaid_trips FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (driver_id = auth.uid() AND status IN ('pending_review', 'needs_fix'))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (driver_id = auth.uid() AND status IN ('pending_review', 'needs_fix'))
  );

CREATE POLICY "Admins delete"
  ON public.medicaid_trips FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_medicaid_trips_updated_at
  BEFORE UPDATE ON public.medicaid_trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime for admin billing queue
ALTER PUBLICATION supabase_realtime ADD TABLE public.medicaid_trips;
