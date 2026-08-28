-- =====================================================================
-- RedArt - TARGET BOOTSTRAP (schema only, generated, DO NOT EDIT BY HAND)
-- Generated from supabase/migrations/*.sql in chronological filename order.
-- Regenerate with: python3 scripts/build_target_bootstrap.py
--
-- PURPOSE
--   Replay the complete RedArt schema onto a FRESH, EMPTY Supabase project
--   (the migration mirror target). Contains NO data, NO credentials and NO
--   environment changes. Never run this against the production project.
--
-- HOW TO RUN (external execution, by a human with target DB access)
--   psql "<TARGET_DIRECT_CONNECTION_STRING>" -v ON_ERROR_STOP=1 \
--        -f scripts/redart_target_bootstrap.sql
--   Run it exactly once on an empty project. It is NOT a full re-runnable
--   script: the historical migrations include ALTER/DROP steps that assume
--   the prior state, so a partial failure must be fixed forward, not retried
--   from the top.
--
-- PREREQUISITES ON THE TARGET
--   * Standard Supabase project (auth, storage, vault, graphql schemas present).
--   * Extensions used: pgcrypto, uuid-ossp, pg_net, pg_cron, supabase_vault.
--     pg_cron/pg_net are created by the migrations themselves; supabase_vault
--     and pgcrypto ship enabled on Supabase.
--   * Storage BUCKETS are NOT created here (Supabase rejects SQL writes to
--     storage.buckets). Create them on the target via the Storage API/UI
--     before running, or the storage.objects policies below will simply have
--     no buckets to apply to. Required buckets (all PRIVATE):
--       avatars, company-logos, driver-docs, driver-photos, games,
--       gas-receipts, incidents, inspections, odometers, profiles, receipts,
--       signatures, state-pdfs, trip-media, vehicle-photos
--
-- DOCUMENTED EXCEPTIONS / DEVIATIONS FROM THE RAW MIGRATIONS
--   1. 20260819155525_821bb0d5-77f3-46b1-83c3-f63bb5cad4d2.sql
--      The cron.schedule + net.http_post block in that migration is COMMENTED
--      OUT here. Replaying it verbatim would make the MIRROR project post to
--      the PRODUCTION app endpoint using the PRODUCTION anon key, creating a
--      second live claim-status processor. Re-enable only at cutover, with the
--      target's own URL and anon key.
--   2. vault.create_secret / vault.decrypted_secrets are referenced inside
--      several SECURITY DEFINER functions (SSN + portal-credential storage).
--      Those function bodies compile fine on a fresh project, but the secrets
--      themselves are NOT migrated - vault contents must be re-entered on the
--      target by a human. No plaintext secret appears in this file.
--   3. Policies on storage.objects are included; they are inert until the
--      matching buckets exist (see PREREQUISITES).
--   4. Nothing here touches auth.users rows. Auth users are a separate
--      migration step (see scripts/redart_target_manifest.md).
-- =====================================================================


-- ---------------------------------------------------------------------
-- [001/144] 20260702235601_23865996-5205-40c2-be23-29dfb05945c5.sql
-- ---------------------------------------------------------------------

-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'driver', 'passenger');

CREATE TYPE public.driver_status AS ENUM ('available', 'on_trip', 'offline');

CREATE TYPE public.trip_status AS ENUM (
  'scheduled',
  'assigned',
  'driver_en_route_to_pickup',
  'arrived_at_pickup',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

CREATE TYPE public.billing_status AS ENUM ('pending', 'submitted', 'paid', 'rejected');

CREATE TYPE public.shift_status AS ENUM ('scheduled', 'completed', 'no_show');

CREATE TYPE public.incident_type AS ENUM ('accident', 'late', 'no_show', 'complaint', 'mechanical', 'other');

CREATE TYPE public.incident_status AS ENUM ('open', 'reviewed', 'closed');

-- =========================================================
-- HELPER: updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- USER ROLES + has_role()
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(_role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = _role
  )
$$;

-- Profile policies (now that has_role exists)
CREATE POLICY "profiles self read" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.current_user_has_role('admin'));
CREATE POLICY "profiles self update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR public.current_user_has_role('admin'));
CREATE POLICY "profiles admin insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.current_user_has_role('admin'));

-- user_roles policies
CREATE POLICY "user_roles self read" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_has_role('admin'));

-- Trigger: create profile row on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- DRIVERS
-- =========================================================
CREATE TABLE public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  license_number TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_plate TEXT,
  vehicle_color TEXT,
  status public.driver_status NOT NULL DEFAULT 'offline',
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  photo_url TEXT,
  rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  total_ratings INTEGER NOT NULL DEFAULT 0,
  total_trips INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers admin all" ON public.drivers
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "drivers self read" ON public.drivers
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "drivers self update" ON public.drivers
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Drivers can see other drivers' minimal info for dispatch (map)
CREATE POLICY "drivers all drivers read" ON public.drivers
  FOR SELECT TO authenticated USING (public.current_user_has_role('driver'));

CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- PASSENGERS
-- =========================================================
CREATE TABLE public.passengers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  phone TEXT,
  email TEXT,
  medicaid_id TEXT NOT NULL UNIQUE,
  county TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.passengers TO authenticated;
GRANT ALL ON public.passengers TO service_role;

ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passengers admin all" ON public.passengers
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "passengers driver read" ON public.passengers
  FOR SELECT TO authenticated USING (public.current_user_has_role('driver'));

CREATE POLICY "passengers self read" ON public.passengers
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER trg_passengers_updated BEFORE UPDATE ON public.passengers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TRIPS
-- =========================================================
CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  passenger_id UUID NOT NULL REFERENCES public.passengers(id) ON DELETE RESTRICT,
  status public.trip_status NOT NULL DEFAULT 'scheduled',
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  dropoff_address TEXT NOT NULL,
  dropoff_lat DOUBLE PRECISION,
  dropoff_lng DOUBLE PRECISION,
  waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_pickup_time TIMESTAMPTZ NOT NULL,
  actual_pickup_time TIMESTAMPTZ,
  actual_dropoff_time TIMESTAMPTZ,
  odometer_start INTEGER,
  odometer_end INTEGER,
  computed_miles NUMERIC(8,2),
  gps_miles NUMERIC(8,2),
  gps_route JSONB NOT NULL DEFAULT '[]'::jsonb,
  odometer_start_photo TEXT,
  odometer_end_photo TEXT,
  billing_status public.billing_status NOT NULL DEFAULT 'pending',
  passenger_rating INTEGER CHECK (passenger_rating BETWEEN 1 AND 5),
  passenger_rating_note TEXT,
  notes TEXT,
  is_problem BOOLEAN NOT NULL DEFAULT false,
  problem_reason TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'manual',
  hcpf_claim_number TEXT,
  patient_confirmed BOOLEAN NOT NULL DEFAULT false,
  patient_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trips_driver ON public.trips(driver_id);
CREATE INDEX idx_trips_passenger ON public.trips(passenger_id);
CREATE INDEX idx_trips_status ON public.trips(status);
CREATE INDEX idx_trips_scheduled ON public.trips(scheduled_pickup_time);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT SELECT ON public.trips TO anon;
GRANT ALL ON public.trips TO service_role;

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips admin all" ON public.trips
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "trips driver read own" ON public.trips
  FOR SELECT TO authenticated USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

CREATE POLICY "trips driver update own" ON public.trips
  FOR UPDATE TO authenticated USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

CREATE POLICY "trips passenger read own" ON public.trips
  FOR SELECT TO authenticated USING (
    passenger_id IN (SELECT id FROM public.passengers WHERE user_id = auth.uid())
  );

-- Public read for passenger trip tracking (used with explicit trip id)
CREATE POLICY "trips public read by id" ON public.trips
  FOR SELECT TO anon USING (true);

CREATE TRIGGER trg_trips_updated BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- After rating: recompute driver rating
CREATE OR REPLACE FUNCTION public.update_driver_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.passenger_rating IS NOT NULL AND (OLD.passenger_rating IS NULL OR OLD.passenger_rating <> NEW.passenger_rating) THEN
    UPDATE public.drivers d
    SET
      total_ratings = (SELECT COUNT(*) FROM public.trips WHERE driver_id = NEW.driver_id AND passenger_rating IS NOT NULL),
      rating = COALESCE((SELECT AVG(passenger_rating)::NUMERIC(3,2) FROM public.trips WHERE driver_id = NEW.driver_id AND passenger_rating IS NOT NULL), 0)
    WHERE d.id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_trips_rating_update AFTER UPDATE OF passenger_rating ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.update_driver_rating();

-- Increment total_trips on completion
CREATE OR REPLACE FUNCTION public.increment_driver_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET total_trips = total_trips + 1 WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_trips_completed AFTER UPDATE OF status ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.increment_driver_trips();

-- =========================================================
-- BILLING RECORDS
-- =========================================================
CREATE TABLE public.billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_code TEXT,
  diagnosis_code TEXT,
  units NUMERIC(8,2) NOT NULL DEFAULT 1,
  rate_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  status public.billing_status NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_records TO authenticated;
GRANT ALL ON public.billing_records TO service_role;

ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing admin all" ON public.billing_records
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER trg_billing_updated BEFORE UPDATE ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- MESSAGES
-- =========================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role public.app_role NOT NULL,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_driver ON public.messages(driver_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages admin all" ON public.messages
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "messages driver read own thread" ON public.messages
  FOR SELECT TO authenticated USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

CREATE POLICY "messages driver insert own thread" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
    AND sender_id = auth.uid()
  );

CREATE POLICY "messages driver update own read flag" ON public.messages
  FOR UPDATE TO authenticated USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- =========================================================
-- SHIFTS
-- =========================================================
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status public.shift_status NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_driver_date ON public.shifts(driver_id, shift_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shifts admin all" ON public.shifts
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "shifts driver read own" ON public.shifts
  FOR SELECT TO authenticated USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- FUEL LOGS
-- =========================================================
CREATE TABLE public.fuel_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gallons NUMERIC(6,2) NOT NULL,
  cost_per_gallon NUMERIC(6,3) NOT NULL,
  total_cost NUMERIC(8,2) NOT NULL,
  odometer INTEGER,
  station TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fuel_driver ON public.fuel_logs(driver_id, log_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_logs TO authenticated;
GRANT ALL ON public.fuel_logs TO service_role;

ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fuel admin all" ON public.fuel_logs
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "fuel driver rw own" ON public.fuel_logs
  FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE TRIGGER trg_fuel_updated BEFORE UPDATE ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- INSPECTIONS (one per driver per day)
-- =========================================================
CREATE TABLE public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  items JSONB NOT NULL,
  passed BOOLEAN NOT NULL,
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, inspection_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspections TO authenticated;
GRANT ALL ON public.inspections TO service_role;

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspections admin all" ON public.inspections
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "inspections driver rw own" ON public.inspections
  FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE TRIGGER trg_inspections_updated BEFORE UPDATE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- INCIDENTS
-- =========================================================
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  incident_type public.incident_type NOT NULL,
  description TEXT NOT NULL,
  photo_url TEXT,
  status public.incident_status NOT NULL DEFAULT 'open',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incidents admin all" ON public.incidents
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "incidents driver rw own" ON public.incidents
  FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- REALTIME publication
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;

-- ---------------------------------------------------------------------
-- [002/144] 20260702235621_6aa719db-caf7-4315-afa2-45a4234a5cb1.sql
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_driver_rating() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_driver_trips() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- [003/144] 20260702235635_dd7694a3-6a45-4aa8-9d24-720279ea1718.sql
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM authenticated;

-- ---------------------------------------------------------------------
-- [004/144] 20260702235658_b1f3e6e3-64bc-4d1a-bf05-c9258d870e77.sql
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role;
  _existing_admins INTEGER;
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO _existing_admins FROM public.user_roles WHERE role = 'admin';

  IF _existing_admins = 0 THEN
    _role := 'admin';
  ELSE
    _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'passenger');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- [005/144] 20260702235742_f1f50c72-2e7a-4f6a-8eff-3f5195ae4c94.sql
-- ---------------------------------------------------------------------

-- Allow authenticated users to upload to any of the 5 buckets
CREATE POLICY "authenticated upload nemt buckets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('profiles','odometers','receipts','inspections','incidents'));

-- Allow authenticated users to read any object in these buckets (photos are shared between admin/driver/passenger for legitimate operational reasons; access is already gated by app-level RLS on the parent records)
CREATE POLICY "authenticated read nemt buckets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents'));

-- Allow uploaders to update/delete their own files
CREATE POLICY "authenticated update own nemt objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents') AND owner = auth.uid());

CREATE POLICY "authenticated delete own nemt objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('profiles','odometers','receipts','inspections','incidents') AND owner = auth.uid());

-- ---------------------------------------------------------------------
-- [006/144] 20260703001625_ce300f0c-748f-4395-99c7-8c0802c828fd.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  category TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.games TO authenticated;
GRANT ALL ON public.games TO service_role;

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view active games"
  ON public.games FOR SELECT
  TO authenticated
  USING (is_active OR public.current_user_has_role('admin'));

CREATE POLICY "Admins can insert games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "Admins can update games"
  ON public.games FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "Admins can delete games"
  ON public.games FOR DELETE
  TO authenticated
  USING (public.current_user_has_role('admin'));

CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.games (title, url, thumbnail_url, category, description, sort_order) VALUES
  ('2048', 'https://play2048.co/', 'https://play2048.co/meta/apple-touch-icon.png', 'Puzzle', 'Slide tiles and reach 2048.', 10),
  ('Chess.com', 'https://www.chess.com/play/online', 'https://images.chesscomfiles.com/uploads/v1/images_users/tiny_mce/PedroPinhata/phpkXqXbC.png', 'Board', 'Play chess online.', 20),
  ('Wordle (NYT)', 'https://www.nytimes.com/games/wordle/index.html', 'https://www.nytimes.com/games-assets/v2/assets/wordle/wordle-social-static.png', 'Word', 'Guess the 5-letter word.', 30),
  ('Sudoku', 'https://sudoku.com/', 'https://sudoku.com/favicons/apple-touch-icon.png', 'Puzzle', 'Classic number puzzle.', 40),
  ('Slither.io', 'http://slither.io/', 'https://slither.io/s/apple-touch-icon.png', 'Arcade', 'Grow the longest snake.', 50),
  ('Krunker.io', 'https://krunker.io/', 'https://assets.krunker.io/textures/logo_1024.png', 'Shooter', 'Fast-paced browser FPS.', 60);

-- ---------------------------------------------------------------------
-- [007/144] 20260703011016_9923b82e-123d-4a01-9f52-5e62838ad340.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [008/144] 20260703011040_97c12599-4407-4f55-b2b3-277d1ca15eab.sql
-- ---------------------------------------------------------------------

-- Signatures bucket: driver folder = their user id
CREATE POLICY "Drivers upload own signatures"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Drivers read own signatures; admins all"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- State PDFs: admin only
CREATE POLICY "Admins manage state pdfs"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'state-pdfs' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'state-pdfs' AND public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- [009/144] 20260703011925_a50f7ff7-fb99-4eaa-93a0-77b7706741c8.sql
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;

-- ---------------------------------------------------------------------
-- [010/144] 20260703011937_2eec0942-ae4a-4553-970c-58b53bbd7eac.sql
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;

-- ---------------------------------------------------------------------
-- [011/144] 20260703013338_66d3f139-f287-41ec-afe5-fc3851888a77.sql
-- ---------------------------------------------------------------------

-- Storage policies for games bucket (thumbnails)
CREATE POLICY "games read all authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'games');

CREATE POLICY "games admin write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "games admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "games admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

-- Auto-create drivers row when a user is assigned the 'driver' role
CREATE OR REPLACE FUNCTION public.ensure_driver_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'driver' THEN
    INSERT INTO public.drivers (user_id, status)
    VALUES (NEW.user_id, 'offline')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_driver_row ON public.user_roles;
CREATE TRIGGER trg_ensure_driver_row
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_driver_row();

-- Backfill: create driver rows for any existing users with driver role but no drivers row
INSERT INTO public.drivers (user_id, status)
SELECT ur.user_id, 'offline'
FROM public.user_roles ur
LEFT JOIN public.drivers d ON d.user_id = ur.user_id
WHERE ur.role = 'driver' AND d.id IS NULL;

-- ---------------------------------------------------------------------
-- [012/144] 20260703020425_a26600a2-b07f-41f5-9bfe-c3bf0951388f.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(10,2);
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver_rating SMALLINT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver_rating_note TEXT;

CREATE TABLE IF NOT EXISTS public.ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat NUMERIC(10,7) NOT NULL,
  pickup_lng NUMERIC(10,7) NOT NULL,
  dropoff_address TEXT NOT NULL,
  dropoff_lat NUMERIC(10,7) NOT NULL,
  dropoff_lng NUMERIC(10,7) NOT NULL,
  distance_km NUMERIC(10,2),
  estimated_fare NUMERIC(10,2),
  estimated_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled','expired')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_requests TO authenticated;
GRANT ALL ON public.ride_requests TO service_role;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Passengers manage their own requests" ON public.ride_requests;
CREATE POLICY "Passengers manage their own requests" ON public.ride_requests
  FOR ALL TO authenticated USING (passenger_id = auth.uid()) WITH CHECK (passenger_id = auth.uid());

DROP POLICY IF EXISTS "Drivers see pending and assigned requests" ON public.ride_requests;
CREATE POLICY "Drivers see pending and assigned requests" ON public.ride_requests
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'driver'::public.app_role)
    AND (status = 'pending' OR driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Drivers update their assigned or claim pending" ON public.ride_requests;
CREATE POLICY "Drivers update their assigned or claim pending" ON public.ride_requests
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'driver'::public.app_role)
    AND (status = 'pending' OR driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Admins full access ride_requests" ON public.ride_requests;
CREATE POLICY "Admins full access ride_requests" ON public.ride_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_ride_requests_updated ON public.ride_requests;
CREATE TRIGGER trg_ride_requests_updated BEFORE UPDATE ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.saved_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('home','work','custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_places TO authenticated;
GRANT ALL ON public.saved_places TO service_role;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their saved places" ON public.saved_places;
CREATE POLICY "Users manage their saved places" ON public.saved_places
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_saved_places_updated ON public.saved_places;
CREATE TRIGGER trg_saved_places_updated BEFORE UPDATE ON public.saved_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  link_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.news_items TO authenticated;
GRANT ALL ON public.news_items TO service_role;
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read active news" ON public.news_items;
CREATE POLICY "Anyone signed in can read active news" ON public.news_items
  FOR SELECT TO authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage news" ON public.news_items;
CREATE POLICY "Admins manage news" ON public.news_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_news_items_updated ON public.news_items;
CREATE TRIGGER trg_news_items_updated BEFORE UPDATE ON public.news_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_fare NUMERIC(10,2) NOT NULL DEFAULT 3.00,
  per_km NUMERIC(10,2) NOT NULL DEFAULT 1.50,
  per_minute NUMERIC(10,2) NOT NULL DEFAULT 0.25,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_config TO authenticated;
GRANT ALL ON public.pricing_config TO service_role;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in reads pricing" ON public.pricing_config;
CREATE POLICY "Anyone signed in reads pricing" ON public.pricing_config
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage pricing" ON public.pricing_config;
CREATE POLICY "Admins manage pricing" ON public.pricing_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_pricing_config_updated ON public.pricing_config;
CREATE TRIGGER trg_pricing_config_updated BEFORE UPDATE ON public.pricing_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.pricing_config (base_fare, per_km, per_minute, currency)
SELECT 3.00, 1.50, 0.25, 'USD'
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_config);

-- Realtime (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='trips') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.trips';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ride_requests') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- [013/144] 20260703040813_277a5bbe-f95a-44ba-b01e-ffe804f96ba8.sql
-- ---------------------------------------------------------------------

-- Chat system: 3-way (driver↔admin, passenger↔admin, driver↔passenger during active trip)
-- and passenger self-signup wiring.

-- 1) Update handle_new_user so signups with role='passenger' also get a passengers row
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role;
  _existing_admins INTEGER;
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO _existing_admins FROM public.user_roles WHERE role = 'admin';

  IF _existing_admins = 0 THEN
    _role := 'admin';
  ELSE
    _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'passenger');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Auto-create passenger row for self-signups so they can be found in dispatch
  IF _role = 'passenger' THEN
    INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'phone', ''),
      'SELF-' || substr(NEW.id::text, 1, 8)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Chat tables
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('driver_admin','passenger_admin','driver_passenger')),
  driver_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  passenger_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_conversations_driver_admin_uniq
  ON public.chat_conversations (driver_user_id)
  WHERE kind = 'driver_admin';

CREATE UNIQUE INDEX chat_conversations_passenger_admin_uniq
  ON public.chat_conversations (passenger_user_id)
  WHERE kind = 'passenger_admin';

CREATE UNIQUE INDEX chat_conversations_trip_uniq
  ON public.chat_conversations (trip_id)
  WHERE kind = 'driver_passenger' AND trip_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants and admins can view conversations"
  ON public.chat_conversations FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR driver_user_id = auth.uid()
    OR passenger_user_id = auth.uid()
  );

CREATE POLICY "Participants can create their conversations"
  ON public.chat_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR driver_user_id = auth.uid()
    OR passenger_user_id = auth.uid()
  );

CREATE POLICY "Admins can update conversations"
  ON public.chat_conversations FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_conv_created_idx
  ON public.chat_messages (conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants and admins can view messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Participants and admins can send messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (c.is_closed = false OR public.has_role(auth.uid(),'admin'))
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Recipients can mark messages read"
  ON public.chat_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  )
  WITH CHECK (true);

-- Bump conversation last_message_at + auto-open on new message
CREATE OR REPLACE FUNCTION public.bump_chat_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.chat_conversations
     SET last_message_at = NEW.created_at,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_messages_bump
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_chat_conversation();

-- 3) Auto driver↔passenger conversation on active trip
CREATE OR REPLACE FUNCTION public.sync_trip_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _driver_user UUID;
  _passenger_user UUID;
BEGIN
  IF NEW.status = 'in_progress' AND (OLD.status IS DISTINCT FROM 'in_progress') THEN
    SELECT user_id INTO _driver_user FROM public.drivers WHERE id = NEW.driver_id;
    SELECT user_id INTO _passenger_user FROM public.passengers WHERE id = NEW.passenger_id;
    IF _driver_user IS NOT NULL AND _passenger_user IS NOT NULL THEN
      INSERT INTO public.chat_conversations
        (kind, driver_user_id, passenger_user_id, trip_id, is_closed)
      VALUES ('driver_passenger', _driver_user, _passenger_user, NEW.id, false)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF NEW.status IN ('completed','cancelled') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.chat_conversations
       SET is_closed = true
     WHERE trip_id = NEW.id AND kind = 'driver_passenger';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_sync_chat
  AFTER UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.sync_trip_chat();

-- 4) Enable Realtime for chat tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- ---------------------------------------------------------------------
-- [014/144] 20260703054812_5b5824c5-1832-4093-98ed-efe77fd76206.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signer_name text;

-- ---------------------------------------------------------------------
-- [015/144] 20260703060446_158eab84-cd0b-403c-b67e-c350e2a0dd03.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ride_requests ALTER COLUMN passenger_id DROP NOT NULL, ALTER COLUMN pickup_lat DROP NOT NULL, ALTER COLUMN pickup_lng DROP NOT NULL, ALTER COLUMN dropoff_lat DROP NOT NULL, ALTER COLUMN dropoff_lng DROP NOT NULL, ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS contact_phone text, ADD COLUMN IF NOT EXISTS contact_medicaid text, ADD COLUMN IF NOT EXISTS requested_pickup_time timestamptz, ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

DROP POLICY IF EXISTS "Public can read active news" ON public.news_items;
CREATE POLICY "Public can read active news" ON public.news_items FOR SELECT TO anon USING (is_active = true);
GRANT SELECT ON public.news_items TO anon;

DROP POLICY IF EXISTS "Public can read active games" ON public.games;
CREATE POLICY "Public can read active games" ON public.games FOR SELECT TO anon USING (is_active = true);
GRANT SELECT ON public.games TO anon;

-- ---------------------------------------------------------------------
-- [016/144] 20260704143451_19dfe661-4d57-49c1-a3a3-84edfa29ffa3.sql
-- ---------------------------------------------------------------------

-- Add avatar_url to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Storage policies for the avatars bucket (bucket itself created via tool)
DO $$ BEGIN
  CREATE POLICY "avatars public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars owner upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars owner update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars admin write" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'avatars' AND public.has_role(auth.uid(),'admin'))
    WITH CHECK (bucket_id = 'avatars' AND public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- [017/144] 20260704203853_4463e45c-7418-4f48-97f2-b6abb4c3253a.sql
-- ---------------------------------------------------------------------

-- Allow passenger signups with alternate identifiers, and anonymous device tracking
ALTER TABLE public.passengers ALTER COLUMN medicaid_id DROP NOT NULL;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS ssn_last4 text;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS last_ip text;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS approx_city text;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS approx_region text;
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS passengers_device_id_key
  ON public.passengers(device_id) WHERE device_id IS NOT NULL;

-- Ensure at least one identifier is present
ALTER TABLE public.passengers DROP CONSTRAINT IF EXISTS passengers_identifier_check;
ALTER TABLE public.passengers ADD CONSTRAINT passengers_identifier_check
  CHECK (
    medicaid_id IS NOT NULL
    OR (ssn_last4 IS NOT NULL AND date_of_birth IS NOT NULL)
    OR device_id IS NOT NULL
  );

-- ---------------------------------------------------------------------
-- [018/144] 20260704205153_0d858d05-e51d-48d6-8288-281a296e756f.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS portal_status TEXT DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS portal_run_id UUID,
  ADD COLUMN IF NOT EXISTS portal_confirmation TEXT,
  ADD COLUMN IF NOT EXISTS portal_evidence_prefix TEXT,
  ADD COLUMN IF NOT EXISTS portal_error TEXT,
  ADD COLUMN IF NOT EXISTS portal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_mfa_prompt TEXT;

-- ---------------------------------------------------------------------
-- [019/144] 20260704211247_2dc96a7c-a548-4ee0-bd4e-05c531a9142a.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [020/144] 20260705002920_c99d4f9f-5895-42ff-908f-55f28bfc7e16.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.medicaid_trips ADD COLUMN IF NOT EXISTS state_pdf_generated_at timestamptz;

-- ---------------------------------------------------------------------
-- [021/144] 20260705003016_0ffeee36-f7de-4302-ad4f-5be5ec012b40.sql
-- ---------------------------------------------------------------------
CREATE POLICY "Drivers upload own state pdfs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'state-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Drivers read own state pdfs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'state-pdfs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Drivers update own state pdfs" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'state-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'state-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- [022/144] 20260705011032_5fb88a89-2aff-4720-8080-cb9e54aedf1a.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [023/144] 20260705025906_f74dac4c-43e4-4d96-a775-afe3b2560ac5.sql
-- ---------------------------------------------------------------------

-- Rename the legacy billing table so we can reuse the name for the Medicaid pipeline
ALTER TABLE public.billing_records RENAME TO trip_billing_records;
ALTER INDEX IF EXISTS billing_records_pkey RENAME TO trip_billing_records_pkey;

-- ==========================================================
-- BILLING RECORDS (Medicaid pipeline)
-- ==========================================================
CREATE TABLE public.billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  trip_form_id UUID,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_submit','submitting','submitted','approved','rejected','needs_fix')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  fix_notes TEXT,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  state_confirmation_number TEXT,
  submission_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX billing_records_status_idx ON public.billing_records (status, updated_at DESC);
CREATE INDEX billing_records_trip_idx ON public.billing_records (trip_id);

GRANT SELECT, INSERT, UPDATE ON public.billing_records TO authenticated;
GRANT ALL ON public.billing_records TO service_role;

ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_records admin all"
  ON public.billing_records FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "billing_records driver read own"
  ON public.billing_records FOR SELECT TO authenticated
  USING (
    trip_id IN (SELECT id FROM public.medicaid_trips WHERE driver_id = auth.uid())
  );

CREATE TRIGGER trg_billing_records_updated_at
  BEFORE UPDATE ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_billing_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_review') THEN
    INSERT INTO public.billing_records (trip_id, trip_form_id, status)
    VALUES (NEW.id, NEW.id, 'pending_review')
    ON CONFLICT (trip_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ensure_billing_record
  AFTER INSERT OR UPDATE OF status ON public.medicaid_trips
  FOR EACH ROW EXECUTE FUNCTION public.ensure_billing_record();

-- Backfill existing medicaid trips
INSERT INTO public.billing_records (trip_id, trip_form_id, status, submitted_at, state_confirmation_number)
SELECT id, id,
  CASE status::text
    WHEN 'pending_review' THEN 'pending_review'
    WHEN 'approved'       THEN 'pending_submit'
    WHEN 'submitted'      THEN 'submitted'
    WHEN 'rejected'       THEN 'rejected'
    WHEN 'needs_fix'      THEN 'needs_fix'
    ELSE 'pending_review'
  END,
  submitted_at,
  submitted_confirmation
FROM public.medicaid_trips
ON CONFLICT (trip_id) DO NOTHING;

-- ==========================================================
-- BILLING AUDIT LOG
-- ==========================================================
CREATE TABLE public.billing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_record_id UUID NOT NULL REFERENCES public.billing_records(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'admin' CHECK (actor_type IN ('admin','driver','system')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX billing_audit_log_record_idx ON public.billing_audit_log (billing_record_id, created_at DESC);

GRANT SELECT, INSERT ON public.billing_audit_log TO authenticated;
GRANT ALL ON public.billing_audit_log TO service_role;

ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_audit_log admin all"
  ON public.billing_audit_log FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

-- ==========================================================
-- STATE PORTAL CREDENTIALS (password via Supabase Vault)
-- ==========================================================
CREATE TABLE public.state_portal_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_name TEXT NOT NULL,
  state TEXT NOT NULL,
  login_email TEXT NOT NULL,
  password_secret_id UUID,
  password_last4 TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_name, state)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_portal_credentials TO authenticated;
GRANT ALL ON public.state_portal_credentials TO service_role;

ALTER TABLE public.state_portal_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_credentials admin all"
  ON public.state_portal_credentials FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER trg_portal_credentials_updated_at
  BEFORE UPDATE ON public.state_portal_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_name TEXT,
  _state TEXT,
  _login_email TEXT,
  _login_password TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id INTO _existing_id FROM public.state_portal_credentials
   WHERE portal_name = _portal_name AND state = _state;

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_name || '_' || _state || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_name, state, login_email, password_secret_id, password_last4)
    VALUES (_portal_name, _state, _login_email, _new_secret_id, _last4)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ==========================================================
-- REALTIME
-- ==========================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_records') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_records';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_audit_log') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_audit_log';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- [024/144] 20260705040925_2c7472d5-084c-4010-a741-cf5c86b910cd.sql
-- ---------------------------------------------------------------------

-- 1. Extend state_portal_credentials
ALTER TABLE public.state_portal_credentials
  ADD COLUMN IF NOT EXISTS portal_id TEXT,
  ADD COLUMN IF NOT EXISTS company_id UUID;

-- Backfill portal_id for any existing rows so we can require it going forward
UPDATE public.state_portal_credentials
   SET portal_id = lower(regexp_replace(portal_name, '\s+', '-', 'g')) || '-' || lower(state)
 WHERE portal_id IS NULL;

ALTER TABLE public.state_portal_credentials
  ALTER COLUMN portal_id SET NOT NULL;

-- Drop old uniqueness on (portal_name, state) if present, add new on (portal_id, company_id)
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.state_portal_credentials'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE public.state_portal_credentials DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS state_portal_credentials_portal_company_uidx
  ON public.state_portal_credentials (portal_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. billing_records.requires_human_step
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS requires_human_step BOOLEAN NOT NULL DEFAULT false;

-- 3. billing_settings singleton
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID UNIQUE,
  default_portal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read billing settings" ON public.billing_settings;
CREATE POLICY "admins read billing settings"
  ON public.billing_settings FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('admin'));

-- Ensure a single default row exists (company_id NULL for now = "this workspace")
INSERT INTO public.billing_settings (company_id, default_portal_id)
SELECT NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.billing_settings WHERE company_id IS NULL);

DROP TRIGGER IF EXISTS billing_settings_set_updated_at ON public.billing_settings;
CREATE TRIGGER billing_settings_set_updated_at
  BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Updated upsert function — includes portal_id + company_id
CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_id TEXT,
  _portal_name TEXT,
  _state TEXT,
  _login_email TEXT,
  _login_password TEXT,
  _company_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id)
    VALUES
      (_portal_id, _portal_name, _state, _login_email, _new_secret_id, _last4, _company_id)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;

-- 5. Fetch decrypted portal credentials — service-role only (called from edge fn)
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(
  _portal_id TEXT,
  _company_id UUID DEFAULT NULL
)
RETURNS TABLE(portal_id TEXT, portal_name TEXT, state TEXT, login_email TEXT, login_password TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  RETURN QUERY
  SELECT c.portal_id,
         c.portal_name,
         c.state,
         c.login_email,
         (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = c.password_secret_id) AS login_password
    FROM public.state_portal_credentials c
   WHERE c.portal_id = _portal_id
     AND COALESCE(c.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  UPDATE public.state_portal_credentials
     SET last_used_at = now()
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(TEXT, UUID) TO service_role;

-- 6. Set default portal (admin)
CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id TEXT, _company_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company_id, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
END;
$function$;

-- ---------------------------------------------------------------------
-- [025/144] 20260709043034_1cd7df22-1b79-4e72-90fe-319a016ce416.sql
-- ---------------------------------------------------------------------

-- Events table
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read active events"
  ON public.events FOR SELECT TO authenticated
  USING (is_active = true OR public.current_user_has_role('admin'));

CREATE POLICY "Admins manage events"
  ON public.events FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Push subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subs"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all push subs"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- Admin notifications feed
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  url text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read admin notifications"
  ON public.admin_notifications FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

CREATE POLICY "Admins update admin notifications"
  ON public.admin_notifications FOR UPDATE TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- ---------------------------------------------------------------------
-- [026/144] 20260709043507_0dfc7cf6-2b87-483b-8f46-9aa6d3bf84af.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [027/144] 20260710044021_37c5f88f-d045-477f-bcbe-bb50101a0962.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.billing_rate_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('ambulatory','wheelchair_van')),
  procedure_code text NOT NULL,
  charge_amount numeric(10,2) NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('trip','mile')),
  place_of_service text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, vehicle_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_rate_settings TO authenticated;
GRANT ALL ON public.billing_rate_settings TO service_role;

ALTER TABLE public.billing_rate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all billing rate settings"
  ON public.billing_rate_settings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_billing_rate_settings_updated_at
  BEFORE UPDATE ON public.billing_rate_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [028/144] 20260710050613_a5c7bab8-a1b6-4886-903b-d8fc66344983.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.robot_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.robot_api_keys TO authenticated;
GRANT ALL ON public.robot_api_keys TO service_role;

ALTER TABLE public.robot_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage robot api keys"
ON public.robot_api_keys
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_robot_api_keys_active ON public.robot_api_keys (is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- [029/144] 20260710052049_6f5d46f3-6097-426b-8802-3cb087b58e29.sql
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "trips public read by id" ON public.trips;

CREATE OR REPLACE FUNCTION public.get_public_trip_track(_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'pickup_address', t.pickup_address,
    'dropoff_address', t.dropoff_address,
    'pickup_lat', t.pickup_lat,
    'pickup_lng', t.pickup_lng,
    'dropoff_lat', t.dropoff_lat,
    'dropoff_lng', t.dropoff_lng,
    'gps_route', t.gps_route,
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone
      )
    ) END
  )
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE t.id = _trip_id
$$;
REVOKE ALL ON FUNCTION public.get_public_trip_track(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_trip_track(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.driver_can_see_passenger(_passenger_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
     WHERE d.user_id = auth.uid()
       AND t.passenger_id = _passenger_id
  )
$$;
REVOKE ALL ON FUNCTION public.driver_can_see_passenger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_can_see_passenger(uuid) TO authenticated;

DROP POLICY IF EXISTS "passengers driver read" ON public.passengers;
CREATE POLICY "passengers driver read assigned"
  ON public.passengers
  FOR SELECT
  TO authenticated
  USING (public.driver_can_see_passenger(id));

DROP POLICY IF EXISTS "drivers all drivers read" ON public.drivers;

CREATE OR REPLACE FUNCTION public.riders_force_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.riders_force_created_by() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS riders_force_created_by ON public.riders;
CREATE TRIGGER riders_force_created_by
  BEFORE INSERT ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.riders_force_created_by();

REVOKE ALL ON FUNCTION public.ensure_billing_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_driver_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admin_driver_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admin_new_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_trip_chat() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_driver_rating() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_driver_trips() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_default_billing_portal(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_billing_portal(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_has_role(app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(app_role) TO authenticated;

-- ---------------------------------------------------------------------
-- [030/144] 20260710052117_394cc2f8-0650-4163-87f6-5da96b432418.sql
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.chat_messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );

-- ---------------------------------------------------------------------
-- [031/144] 20260711150416_294e09d7-36f8-4418-a878-0d5432d79f13.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_rate_settings DROP CONSTRAINT billing_rate_settings_provider_id_vehicle_type_key;
ALTER TABLE public.billing_rate_settings ADD CONSTRAINT billing_rate_settings_provider_vehicle_unit_key UNIQUE (provider_id, vehicle_type, unit_type);

-- ---------------------------------------------------------------------
-- [032/144] 20260715062020_0a03151a-8b14-450f-b950-9ea55f695d74.sql
-- ---------------------------------------------------------------------

-- Add vehicle photo path column to drivers
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vehicle_photo_path text;

-- Storage policies for vehicle-photos bucket
-- Authenticated users can read all vehicle photos (private bucket -> signed URLs)
CREATE POLICY "vehicle_photos_read_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'vehicle-photos');

-- Drivers can upload their own vehicle photos (path starts with their user_id)
CREATE POLICY "vehicle_photos_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "vehicle_photos_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "vehicle_photos_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can manage any vehicle photo
CREATE POLICY "vehicle_photos_admin_all"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'vehicle-photos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'vehicle-photos' AND public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- [033/144] 20260717070515_e9fb4b7a-43cd-4768-aa32-8fa7631c02eb.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_rate_settings ADD COLUMN IF NOT EXISTS default_diagnosis_code TEXT;

-- ---------------------------------------------------------------------
-- [034/144] 20260717145837_7eb7c17d-bdfd-4bbd-ba98-a312a41c8a18.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_job_id text,
  ADD COLUMN IF NOT EXISTS robot_job_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS robot_last_status text,
  ADD COLUMN IF NOT EXISTS robot_last_message text,
  ADD COLUMN IF NOT EXISTS robot_last_checked_at timestamptz;

-- ---------------------------------------------------------------------
-- [035/144] 20260718050744_e99b518c-aa51-4393-a0d1-757f97ea1add.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  RETURN QUERY
  SELECT credential.portal_id,
         credential.portal_name,
         credential.state,
         credential.login_email,
         decrypted.decrypted_secret AS login_password
    FROM public.state_portal_credentials AS credential
    LEFT JOIN vault.decrypted_secrets AS decrypted
      ON decrypted.id = credential.password_secret_id
   WHERE credential.portal_id = _portal_id
     AND COALESCE(credential.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  UPDATE public.state_portal_credentials AS credential
     SET last_used_at = now()
   WHERE credential.portal_id = _portal_id
     AND COALESCE(credential.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);
END;
$function$;

-- ---------------------------------------------------------------------
-- [036/144] 20260718050801_cc29cdb5-47a0-40c4-b046-4beab3f325bf.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(text, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- [037/144] 20260718054651_81c53740-d870-404f-a798-4c231f62a52f.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [038/144] 20260718060506_57427022-fd9a-4f81-a032-a50f22e9d74a.sql
-- ---------------------------------------------------------------------

CREATE TABLE public.rewards_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  rides_required integer NOT NULL DEFAULT 15 CHECK (rides_required > 0),
  period_type text NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('weekly','monthly')),
  prize_description text NOT NULL DEFAULT '$25 Gift Card',
  winners_per_period integer NOT NULL DEFAULT 1 CHECK (winners_per_period > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rewards_settings TO authenticated;
GRANT ALL ON public.rewards_settings TO service_role;
ALTER TABLE public.rewards_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings readable by authed" ON public.rewards_settings FOR SELECT TO authenticated USING (true);
INSERT INTO public.rewards_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.contest_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES public.passengers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  ride_count integer NOT NULL DEFAULT 0,
  qualified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id, period_start)
);
CREATE INDEX idx_contest_entries_period ON public.contest_entries(period_start, period_end);
GRANT SELECT ON public.contest_entries TO authenticated;
GRANT ALL ON public.contest_entries TO service_role;
ALTER TABLE public.contest_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entries own or admin" ON public.contest_entries FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.passengers p WHERE p.id = passenger_id AND p.user_id = auth.uid())
);

CREATE TABLE public.contest_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES public.passengers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  prize_description text NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivery_note text
);
CREATE INDEX idx_contest_winners_period ON public.contest_winners(period_start);
GRANT SELECT ON public.contest_winners TO authenticated;
GRANT ALL ON public.contest_winners TO service_role;
ALTER TABLE public.contest_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "winners readable by authed" ON public.contest_winners FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- [039/144] 20260718165917_8ce06021-0095-4853-8bd9-67b65a8f7a9c.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_trip_track(_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'scheduled_pickup_time', t.scheduled_pickup_time,
    'pickup_address', t.pickup_address,
    'dropoff_address', t.dropoff_address,
    'pickup_lat', t.pickup_lat,
    'pickup_lng', t.pickup_lng,
    'dropoff_lat', t.dropoff_lat,
    'dropoff_lng', t.dropoff_lng,
    'gps_route', t.gps_route,
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone
      )
    ) END
  )
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE t.id = _trip_id
$$;

-- ---------------------------------------------------------------------
-- [040/144] 20260718172752_cbc41e4a-fded-4668-87fe-9fb69c80df23.sql
-- ---------------------------------------------------------------------
CREATE POLICY "driver_photos_read_auth"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'driver-photos');

CREATE POLICY "driver_photos_admin_all"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'driver-photos' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'driver-photos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "driver_photos_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_photos_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_photos_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'driver-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- [041/144] 20260718200458_15362ea7-bcf3-4ed2-882a-bc07ec39f38d.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ride_request_view(_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'request', to_jsonb(r.*),
    'driver', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'current_lat', d.current_lat,
      'current_lng', d.current_lng,
      'vehicle_make', d.vehicle_make,
      'vehicle_model', d.vehicle_model,
      'vehicle_year', d.vehicle_year,
      'vehicle_color', d.vehicle_color,
      'vehicle_plate', d.vehicle_plate,
      'vehicle_photo_path', d.vehicle_photo_path,
      'photo_url', d.photo_url,
      'profile', jsonb_build_object(
        'first_name', p.first_name,
        'last_name', p.last_name,
        'phone', p.phone,
        'avatar_url', p.avatar_url
      )
    ) END
  )
  FROM public.ride_requests r
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  LEFT JOIN public.profiles p ON p.id = d.user_id
  WHERE r.id = _request_id
    AND (
      r.passenger_id = auth.uid()
      OR public.current_user_has_role('admin')
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_ride_request_view(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- [042/144] 20260719025309_3b43d854-4304-4a5f-823e-a05e552956d3.sql
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- [043/144] 20260719202047_6d9f3190-04db-4b2d-99c6-58a9cd0a92f0.sql
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings"
  ON public.app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can write app settings" ON public.app_settings;
CREATE POLICY "Admins can write app settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

INSERT INTO public.app_settings (key, value)
VALUES ('dispatch_phone_number', '+1 (800) 555-1234')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- [044/144] 20260719204903_c27dc821-dad9-45da-b15c-2b6a6d7d559d.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [045/144] 20260719204938_b47873af-6a7b-4a78-aa8a-1d550c4c8ecd.sql
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "gas receipts driver rw" ON storage.objects;
CREATE POLICY "gas receipts driver rw" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'gas-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')))
  WITH CHECK (bucket_id = 'gas-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')));

DROP POLICY IF EXISTS "trip media driver rw" ON storage.objects;
CREATE POLICY "trip media driver rw" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'trip-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')))
  WITH CHECK (bucket_id = 'trip-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin')));

-- ---------------------------------------------------------------------
-- [046/144] 20260719213133_8d58a238-db3b-40cc-bf06-565608e32022.sql
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS passengers_device_id_key ON public.passengers (device_id) WHERE device_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- [047/144] 20260720042845_beda2268-5af6-42e6-b734-52a34b8478fe.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS stops jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------
-- [048/144] 20260720050049_ee36d72c-e58a-4fab-9d82-a8d60c097731.sql
-- ---------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role) VALUES ('0d337259-86cc-4ffd-8fde-775fc579e146', 'admin') ON CONFLICT (user_id, role) DO NOTHING;

-- ---------------------------------------------------------------------
-- [049/144] 20260721042201_852157e6-91c2-4605-b909-25a9ccfa5a4c.sql
-- ---------------------------------------------------------------------
-- Encrypted SSN references (values live in Supabase Vault, not in these tables)
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS ssn_secret_id UUID;
ALTER TABLE public.riders     ADD COLUMN IF NOT EXISTS ssn_secret_id UUID;

-- ------------------------------------------------------------------
-- Passenger-owned SSN: the signed-in passenger (or an admin) may set it.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_passenger_ssn(_passenger_id UUID, _ssn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _owner UUID;
  _digits TEXT;
  _sid UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  SELECT user_id INTO _owner FROM public.passengers WHERE id = _passenger_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'passenger not found';
  END IF;

  IF _owner IS DISTINCT FROM auth.uid()
     AND NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  _sid := vault.create_secret(
    _digits,
    'passenger_ssn_' || _passenger_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Passenger SSN (encrypted)'
  );

  UPDATE public.passengers
     SET ssn_secret_id = _sid,
         ssn_last4 = right(_digits, 4),
         updated_at = now()
   WHERE id = _passenger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_passenger_ssn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO authenticated;

-- ------------------------------------------------------------------
-- Rider-owned SSN: any signed-in user who can access the rider row per RLS
-- may attach an SSN. The rider check runs against the RLS-visible row.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_rider_ssn(_rider_id UUID, _ssn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _digits TEXT;
  _sid UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.riders WHERE id = _rider_id) THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  _sid := vault.create_secret(
    _digits,
    'rider_ssn_' || _rider_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Rider SSN (encrypted)'
  );

  UPDATE public.riders
     SET ssn_secret_id = _sid,
         last_4_ssn = right(_digits, 4),
         updated_at = now()
   WHERE id = _rider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rider_ssn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO authenticated;

-- ------------------------------------------------------------------
-- Transfer a passenger's SSN secret onto a rider row (used when the
-- driver materializes a rider from a passenger-app row at pickup).
-- Restricted to authenticated users; the SSN never enters the client.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_passenger_ssn_to_rider(_passenger_id UUID, _rider_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _digits TEXT;
  _sid    UUID;
  _src    UUID;
BEGIN
  IF auth.uid() IS NULL
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.riders WHERE id = _rider_id) THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  SELECT ssn_secret_id INTO _src FROM public.passengers WHERE id = _passenger_id;
  IF _src IS NULL THEN
    RETURN; -- nothing to copy
  END IF;

  SELECT decrypted_secret INTO _digits FROM vault.decrypted_secrets WHERE id = _src;
  IF _digits IS NULL THEN
    RETURN;
  END IF;

  _sid := vault.create_secret(
    _digits,
    'rider_ssn_' || _rider_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Rider SSN (encrypted, copied from passenger)'
  );

  UPDATE public.riders
     SET ssn_secret_id = _sid,
         last_4_ssn = right(_digits, 4),
         updated_at = now()
   WHERE id = _rider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------
-- Decrypt helpers — ADMIN OR SERVICE ROLE ONLY. Used server-side to
-- fill the "Member Health First Colorado ID #" field on the state PDF
-- when the passenger has no Medicaid ID on file.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_decrypted_passenger_ssn(_passenger_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE _sid UUID; _ssn TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT ssn_secret_id INTO _sid FROM public.passengers WHERE id = _passenger_id;
  IF _sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _ssn FROM vault.decrypted_secrets WHERE id = _sid;
  RETURN _ssn;
END;
$$;

REVOKE ALL ON FUNCTION public.get_decrypted_passenger_ssn(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.get_decrypted_rider_ssn(_rider_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE _sid UUID; _ssn TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin')
     AND current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT ssn_secret_id INTO _sid FROM public.riders WHERE id = _rider_id;
  IF _sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _ssn FROM vault.decrypted_secrets WHERE id = _sid;
  RETURN _ssn;
END;
$$;

REVOKE ALL ON FUNCTION public.get_decrypted_rider_ssn(uuid) FROM PUBLIC, authenticated;

-- ---------------------------------------------------------------------
-- [050/144] 20260724040542_5a4c9dbb-800e-4649-a4d1-2c6c05aa94cd.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.medicaid_trips
ADD COLUMN IF NOT EXISTS dispatch_trip_id uuid;

CREATE INDEX IF NOT EXISTS idx_medicaid_trips_dispatch_trip_id
ON public.medicaid_trips(dispatch_trip_id);

UPDATE public.medicaid_trips mt
SET dispatch_trip_id = t.id
FROM public.trips t
JOIN public.drivers d ON d.id = t.driver_id
JOIN public.passengers p ON p.id = t.passenger_id
JOIN public.riders r ON true
WHERE mt.dispatch_trip_id IS NULL
  AND r.id = mt.rider_id
  AND mt.driver_id = d.user_id
  AND mt.pickup_at = t.actual_pickup_time
  AND mt.odometer_start::integer = t.odometer_start
  AND mt.odometer_end::integer = t.odometer_end
  AND (
    lower(coalesce(r.full_name, '')) = lower(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')))
    OR (r.medicaid_id IS NOT NULL AND p.medicaid_id IS NOT NULL AND r.medicaid_id = p.medicaid_id)
  );

-- ---------------------------------------------------------------------
-- [051/144] 20260724050124_85d396ad-5141-40f4-84ed-46b84e995683.sql
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_trip_report_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_trip_report_drafts_dispatch_trip_id_key UNIQUE (dispatch_trip_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_trip_report_drafts TO authenticated;
GRANT ALL ON public.dispatch_trip_report_drafts TO service_role;

ALTER TABLE public.dispatch_trip_report_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assigned drivers and admins can read drafts"
  ON public.dispatch_trip_report_drafts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Assigned drivers and admins can create drafts"
  ON public.dispatch_trip_report_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Assigned drivers and admins can update drafts"
  ON public.dispatch_trip_report_drafts
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can delete drafts"
  ON public.dispatch_trip_report_drafts
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_dispatch_trip_report_drafts_updated_at ON public.dispatch_trip_report_drafts;
CREATE TRIGGER trg_dispatch_trip_report_drafts_updated_at
  BEFORE UPDATE ON public.dispatch_trip_report_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [052/144] 20260726203152_fe92cae2-6194-4839-b47d-145ac4714c1b.sql
-- ---------------------------------------------------------------------
-- 1. New dispatch role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dispatch';

-- ---------------------------------------------------------------------
-- [053/144] 20260726203401_33506741-6e6d-4138-b864-59aa0aad7450.sql
-- ---------------------------------------------------------------------
-- Helper: is the current user a dispatcher (or admin, who supersedes)
CREATE OR REPLACE FUNCTION public.current_user_is_dispatch()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dispatch','admin')
  )
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_is_dispatch() FROM anon;

-- Trips: real identity verification answer (NULL = never answered)
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS identity_verified boolean;

-- Multi-passenger / multi-stop routes
CREATE TABLE IF NOT EXISTS public.routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO authenticated;
GRANT ALL ON public.routes TO service_role;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routes staff all" ON public.routes FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "routes driver read own" ON public.routes FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));
CREATE POLICY "routes driver update own" ON public.routes FOR UPDATE TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'pickup',
  leg TEXT NOT NULL DEFAULT 'outbound',
  passenger_name TEXT,
  passenger_phone TEXT,
  passenger_medicaid_id TEXT,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  request_id UUID REFERENCES public.ride_requests(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_stops_route_seq_idx ON public.route_stops(route_id, sequence);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_stops TO authenticated;
GRANT ALL ON public.route_stops TO service_role;
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "route_stops staff all" ON public.route_stops FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "route_stops driver read own" ON public.route_stops FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.routes r JOIN public.drivers d ON d.id = r.driver_id
    WHERE r.id = route_stops.route_id AND d.user_id = auth.uid()));
CREATE POLICY "route_stops driver update own" ON public.route_stops FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.routes r JOIN public.drivers d ON d.id = r.driver_id
    WHERE r.id = route_stops.route_id AND d.user_id = auth.uid()));

CREATE TRIGGER routes_set_updated_at BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Dispatch activity audit log
CREATE TABLE IF NOT EXISTS public.dispatch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  actor_id UUID,
  actor_name TEXT,
  actor_role TEXT,
  request_id UUID,
  trip_id UUID,
  route_id UUID,
  driver_id UUID,
  summary TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_events_created_idx ON public.dispatch_events(created_at DESC);
GRANT SELECT ON public.dispatch_events TO authenticated;
GRANT ALL ON public.dispatch_events TO service_role;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatch_events staff read" ON public.dispatch_events FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());

-- Dispatcher read/manage access on operational tables
CREATE POLICY "drivers dispatch read" ON public.drivers FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());
CREATE POLICY "ride_requests dispatch all" ON public.ride_requests FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "trips dispatch all" ON public.trips FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "trip_stops dispatch all" ON public.trip_stops FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "ride_passengers dispatch all" ON public.ride_passengers FOR ALL TO authenticated
  USING (public.current_user_is_dispatch()) WITH CHECK (public.current_user_is_dispatch());
CREATE POLICY "passengers dispatch read" ON public.passengers FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());
CREATE POLICY "profiles dispatch read" ON public.profiles FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());
CREATE POLICY "shifts dispatch read" ON public.shifts FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());
CREATE POLICY "driver_shifts dispatch read" ON public.driver_shifts FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());

-- Realtime for the dispatch board
ALTER PUBLICATION supabase_realtime ADD TABLE public.routes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.route_stops;

-- Auto-assign defaults OFF
INSERT INTO public.app_settings (key, value) VALUES ('auto_assign_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- [054/144] 20260726203734_1238a3b8-f360-4bad-a377-b3c5883cce61.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

UPDATE public.ride_requests
   SET vehicle_type = lower(substring(notes from '\[VEHICLE:([a-zA-Z_]+)\]'))
 WHERE vehicle_type IS NULL
   AND notes ~ '\[VEHICLE:';

-- ---------------------------------------------------------------------
-- [055/144] 20260726212854_2bf77dbb-1e54-4ec5-9c8e-e6a0df77c80b.sql
-- ---------------------------------------------------------------------
-- 1) Self-signup can NEVER pick a privileged role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Every self-signup is a passenger. Privileged roles (driver/dispatch/admin)
  -- are granted only by an admin afterwards via the service role.
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'passenger')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'SELF-' || substr(NEW.id::text, 1, 8)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Explicit: only admins may write roles. (No write policy existed; make it explicit.)
DROP POLICY IF EXISTS "user_roles admin write" ON public.user_roles;
CREATE POLICY "user_roles admin write" ON public.user_roles
FOR ALL TO authenticated
USING (public.current_user_has_role('admin'))
WITH CHECK (public.current_user_has_role('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Defence in depth: block any non-service-role attempt to self-grant a privileged role.
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF current_setting('role', true) = 'service_role' OR session_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);  -- trigger-driven inserts (handle_new_user)
  END IF;
  IF _role IN ('driver', 'dispatch', 'admin') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS guard_user_roles_write ON public.user_roles;
CREATE TRIGGER guard_user_roles_write
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_user_roles_write();

-- 3) Trips: passengers may only create their own pending, unassigned trips.
DROP POLICY IF EXISTS "trips passenger insert pending" ON public.trips;
CREATE POLICY "trips passenger insert pending" ON public.trips
FOR INSERT TO authenticated
WITH CHECK (
  status = 'scheduled'
  AND driver_id IS NULL
  AND passenger_id IN (SELECT p.id FROM public.passengers p WHERE p.user_id = auth.uid())
);

-- 4) Drivers may only advance their own assigned trips, on progress columns.
CREATE OR REPLACE FUNCTION public.guard_trip_driver_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR auth.uid() IS NULL
     OR public.current_user_has_role('admin')
     OR public.current_user_is_dispatch() THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.id = OLD.driver_id AND d.user_id = auth.uid()
  ) THEN
    RETURN NEW; -- not the assigned driver; RLS handles the rest
  END IF;

  -- Assigned driver: driver_id is immutable, and only progress fields may change.
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'Drivers cannot reassign a trip';
  END IF;

  IF (NEW.passenger_id, NEW.pickup_address, NEW.pickup_lat, NEW.pickup_lng,
      NEW.dropoff_address, NEW.dropoff_lat, NEW.dropoff_lng,
      NEW.scheduled_pickup_time, NEW.estimated_fare, NEW.billing_status,
      NEW.hcpf_claim_number, NEW.assignment_type, NEW.passenger_rating)
     IS DISTINCT FROM
     (OLD.passenger_id, OLD.pickup_address, OLD.pickup_lat, OLD.pickup_lng,
      OLD.dropoff_address, OLD.dropoff_lat, OLD.dropoff_lng,
      OLD.scheduled_pickup_time, OLD.estimated_fare, OLD.billing_status,
      OLD.hcpf_claim_number, OLD.assignment_type, OLD.passenger_rating)
  THEN
    RAISE EXCEPTION 'Drivers may only update trip progress fields';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_trip_driver_update ON public.trips;
CREATE TRIGGER guard_trip_driver_update
BEFORE UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.guard_trip_driver_update();

-- ---------------------------------------------------------------------
-- [056/144] 20260729041308_dd9ce75e-8712-41ea-819a-faeb05cfe4fa.sql
-- ---------------------------------------------------------------------
-- 1. Harden set_rider_ssn: it previously had no caller authorization check.
CREATE OR REPLACE FUNCTION public.set_rider_ssn(_rider_id uuid, _ssn text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _digits TEXT;
  _sid UUID;
  _creator UUID;
BEGIN
  _digits := regexp_replace(COALESCE(_ssn, ''), '\D', '', 'g');
  IF length(_digits) <> 9 THEN
    RAISE EXCEPTION 'SSN must be exactly 9 digits';
  END IF;

  SELECT created_by INTO _creator FROM public.riders WHERE id = _rider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role'
     AND NOT public.current_user_has_role('admin')
     AND NOT public.current_user_is_dispatch()
     AND (_creator IS NULL OR _creator IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  _sid := vault.create_secret(
    _digits,
    'rider_ssn_' || _rider_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Rider SSN (encrypted)'
  );

  UPDATE public.riders
     SET ssn_secret_id = _sid,
         last_4_ssn = right(_digits, 4),
         updated_at = now()
   WHERE id = _rider_id;
END;
$function$;

-- 2. Drop the stale 4-argument portal credential overload (ambiguous signature).
DROP FUNCTION IF EXISTS public.upsert_portal_credential(text, text, text, text);

-- 3. Remove anonymous / unnecessary EXECUTE on sensitive + trigger-only functions.
REVOKE ALL ON FUNCTION public.get_decrypted_passenger_ssn(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_rider_ssn(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_passenger_ssn(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_rider_ssn(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_trip_driver_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_user_roles_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_driver_on_trip_end() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_is_dispatch() FROM PUBLIC, anon;

-- 4. Keep the signed-in paths the app actually uses working.
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_dispatch() TO authenticated;

-- 5. Server-side (service role) callers need explicit EXECUTE.
GRANT EXECUTE ON FUNCTION public.get_decrypted_passenger_ssn(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_rider_ssn(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_passenger_ssn(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_rider_ssn(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.copy_passenger_ssn_to_rider(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(text, text, text, text, text, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_billing_portal(text, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_can_see_passenger(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- [057/144] 20260729135336_9cebe835-68cd-4a73-8a38-f0a515108b98.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.requests_on_route(_ids uuid[])
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rs.request_id
    FROM public.route_stops rs
   WHERE rs.request_id = ANY(_ids)
$$;

REVOKE ALL ON FUNCTION public.requests_on_route(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requests_on_route(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- [058/144] 20260730141115_33001bfd-2d6f-425b-9912-18d2b0a40d51.sql
-- ---------------------------------------------------------------------
-- 1) Round-trip linkage on dispatch trips
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS round_trip_group_id uuid,
  ADD COLUMN IF NOT EXISTS round_trip_leg smallint;

CREATE INDEX IF NOT EXISTS trips_round_trip_group_idx
  ON public.trips (round_trip_group_id);

-- 2) Billing settings: remove the empty duplicate and prevent recurrence
DELETE FROM public.billing_settings a
 WHERE a.default_portal_id IS NULL
   AND EXISTS (
     SELECT 1 FROM public.billing_settings b
      WHERE b.id <> a.id
        AND b.company_id IS NOT DISTINCT FROM a.company_id
        AND b.default_portal_id IS NOT NULL
   );

DELETE FROM public.billing_settings a
 USING public.billing_settings b
 WHERE a.company_id IS NOT DISTINCT FROM b.company_id
   AND a.updated_at < b.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS billing_settings_company_uniq
  ON public.billing_settings (company_id) NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------
-- [059/144] 20260730150006_e91d620c-1310-46f9-8ec4-fb6fc5cd85ae.sql
-- ---------------------------------------------------------------------
insert into public.passengers (id, first_name, last_name, phone, medicaid_id, is_active)
values ('11111111-2222-3333-4444-555555555555','QA','MapTest','+13035550111','QA-MAP-0001', true)
on conflict (id) do nothing;

insert into public.drivers (id, user_id, status, current_lat, current_lng, last_location_at)
values ('22222222-3333-4444-5555-666666666666','ef656627-9699-4a35-a741-0e0767e5d295','busy',39.7392,-104.9903, now())
on conflict (id) do update set status='busy';

insert into public.user_roles (user_id, role) values ('ef656627-9699-4a35-a741-0e0767e5d295','driver')
on conflict do nothing;

insert into public.trips (id, passenger_id, driver_id, status, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_time, assignment_type)
values ('33333333-4444-5555-6666-777777777777','11111111-2222-3333-4444-555555555555','22222222-3333-4444-5555-666666666666','assigned','1200 Broadway, Denver, CO',39.7357,-104.9878,'Denver Health, 777 Bannock St, Denver, CO',39.7276,-104.9906, now(), 'manual')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- [060/144] 20260730150158_10f5fa17-5e0a-444f-b3bd-321704327dd8.sql
-- ---------------------------------------------------------------------
delete from public.trips where id='33333333-4444-5555-6666-777777777777';
delete from public.drivers where id='22222222-3333-4444-5555-666666666666';
delete from public.passengers where id='11111111-2222-3333-4444-555555555555';
delete from public.user_roles where user_id='ef656627-9699-4a35-a741-0e0767e5d295' and role='driver';

-- ---------------------------------------------------------------------
-- [061/144] 20260730173638_76bcb72c-18b0-483f-aa28-b9b73362af8b.sql
-- ---------------------------------------------------------------------
insert into public.drivers(id, user_id, status, current_lat, current_lng, last_location_at)
values ('99999999-1111-4111-8111-999999999999','ef656627-9699-4a35-a741-0e0767e5d295','available', 39.7392, -104.9903, now())
on conflict (user_id) do update set status='available';

-- ---------------------------------------------------------------------
-- [062/144] 20260730173708_c1f20bc6-a7e0-4ccb-a8ad-636458f0e119.sql
-- ---------------------------------------------------------------------
insert into public.user_roles(user_id, role) values ('ef656627-9699-4a35-a741-0e0767e5d295','driver') on conflict do nothing;
insert into public.trips(id, driver_id, passenger_id, status, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_time, assignment_type, notes)
values ('11111111-2222-3333-4444-555555555555','99999999-1111-4111-8111-999999999999','cc99bc0f-7a39-488d-8ab9-18fbc121c2c3','assigned','QA MAP TEST 1200 Broadway, Denver, CO',39.7357,-104.9878,'QA MAP TEST 1500 Park Ave, Denver, CO',39.7550,-104.9700, now(),'manual','QA_MAP_TEST');

-- ---------------------------------------------------------------------
-- [063/144] 20260730174935_0ee0dd6a-d4a2-4b40-ad79-f1467b33001f.sql
-- ---------------------------------------------------------------------
delete from public.trips where notes = 'QA_MAP_TEST';
delete from public.user_roles where user_id='ef656627-9699-4a35-a741-0e0767e5d295' and role='driver';

-- ---------------------------------------------------------------------
-- [064/144] 20260730180305_b22860cc-ab52-4564-9190-cf86ec481b6d.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.driver_pay (
  driver_id UUID PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  hourly_rate NUMERIC,
  pay_type public.driver_pay_type NOT NULL DEFAULT 'per_hour',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay TO authenticated;
GRANT ALL ON public.driver_pay TO service_role;

ALTER TABLE public.driver_pay ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver_pay admin only" ON public.driver_pay
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER driver_pay_set_updated_at
  BEFORE UPDATE ON public.driver_pay
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.driver_pay (driver_id, hourly_rate, pay_type)
SELECT id, NULLIF(hourly_rate, 0), pay_type FROM public.drivers
ON CONFLICT (driver_id) DO NOTHING;

ALTER TABLE public.drivers DROP COLUMN hourly_rate;
ALTER TABLE public.drivers DROP COLUMN pay_type;

DROP POLICY IF EXISTS "driver_shifts dispatch read" ON public.driver_shifts;

ALTER TABLE public.gas_receipts
  ADD COLUMN IF NOT EXISTS reimbursed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursed_by UUID;

CREATE POLICY "gas_receipts dispatch read" ON public.gas_receipts
  FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());

-- ---------------------------------------------------------------------
-- [065/144] 20260730181932_d64ca594-beb4-423c-92ef-7f58d2c6e5d9.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric,
  gross_earnings numeric NOT NULL DEFAULT 0,
  fuel_reimbursed numeric NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'manual',
  reference text,
  notes text,
  paid_by uuid,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_payouts_driver_idx ON public.driver_payouts (driver_id, period_end DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_payouts TO authenticated;
GRANT ALL ON public.driver_payouts TO service_role;

ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage driver payouts"
ON public.driver_payouts FOR ALL TO authenticated
USING (public.current_user_has_role('admin'))
WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER driver_payouts_set_updated_at
BEFORE UPDATE ON public.driver_payouts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [066/144] 20260730203015_5c0f53dd-05c3-4d64-95a4-35c962753791.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Authenticated users can read app settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated read nemt buckets" ON storage.objects;
CREATE POLICY "owners and staff read nemt buckets"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = ANY (ARRAY['profiles'::text, 'odometers'::text, 'receipts'::text, 'inspections'::text, 'incidents'::text])
  AND (
    owner = auth.uid()
    OR public.current_user_has_role('admin'::public.app_role)
    OR public.current_user_has_role('dispatch'::public.app_role)
  )
);

-- ---------------------------------------------------------------------
-- [067/144] 20260731180338_55cae2d9-33c4-4fc3-89b9-f46acb76b82f.sql
-- ---------------------------------------------------------------------
-- 1) avatars: authenticated only
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars authenticated read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

-- 2) nemt buckets: ownership on insert
DROP POLICY IF EXISTS "authenticated upload nemt buckets" ON storage.objects;
CREATE POLICY "authenticated upload own nemt objects"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['profiles','odometers','receipts','inspections','incidents'])
  AND owner = auth.uid()
  AND ((storage.foldername(name))[1] = (auth.uid())::text OR public.current_user_has_role('admin'))
);

-- 3) driver/vehicle photos: owner, staff, or a passenger actively riding with that driver
CREATE OR REPLACE FUNCTION public.can_view_driver_media(_driver_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _driver_user_id IS NOT NULL AND (
    _driver_user_id = auth.uid()
    OR public.current_user_has_role('admin')
    OR public.current_user_is_dispatch()
    OR EXISTS (
      SELECT 1 FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      JOIN public.passengers p ON p.id = t.passenger_id
      WHERE d.user_id = _driver_user_id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.ride_requests r
      JOIN public.drivers d ON d.id = r.driver_id
      WHERE d.user_id = _driver_user_id AND r.passenger_id = auth.uid()
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_driver_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_driver_media(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "driver_photos_read_auth" ON storage.objects;
CREATE POLICY "driver_photos_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'driver-photos'
  AND public.can_view_driver_media(NULLIF((storage.foldername(name))[1], '')::uuid)
);

DROP POLICY IF EXISTS "vehicle_photos_read_auth" ON storage.objects;
CREATE POLICY "vehicle_photos_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'vehicle-photos'
  AND public.can_view_driver_media(NULLIF((storage.foldername(name))[1], '')::uuid)
);

-- 4) riders: drivers only see riders they created or who ride with them
CREATE OR REPLACE FUNCTION public.driver_can_see_rider(_rider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.medicaid_trips mt
    WHERE mt.rider_id = _rider_id AND mt.driver_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION public.driver_can_see_rider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_can_see_rider(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Drivers and admins can read riders" ON public.riders;
CREATE POLICY "Riders readable by staff and assigned drivers"
ON public.riders FOR SELECT TO authenticated
USING (
  public.current_user_has_role('admin')
  OR public.current_user_is_dispatch()
  OR created_by = auth.uid()
  OR public.driver_can_see_rider(id)
);

-- 5) revoke anon execute on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.requests_on_route(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ride_request_view(uuid) FROM anon, PUBLIC;

-- ---------------------------------------------------------------------
-- [068/144] 20260801054038_289dd2d6-dddc-4fe0-84b3-6ca24a664f02.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_captured_claim jsonb,
  ADD COLUMN IF NOT EXISTS robot_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS robot_pass text,
  ADD COLUMN IF NOT EXISTS robot_confirmation_number text;

-- ---------------------------------------------------------------------
-- [069/144] 20260801221421_f7f8787a-eb15-4e91-bd13-f14c43e1921c.sql
-- ---------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role) VALUES ('70a5fcd8-e0cb-4ce5-b3b8-a0b4db36ba35','driver') ON CONFLICT DO NOTHING;
INSERT INTO public.drivers (user_id) VALUES ('70a5fcd8-e0cb-4ce5-b3b8-a0b4db36ba35') ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- [070/144] 20260801221805_af2b466a-6cd6-41c0-ba17-7cb57e217cb8.sql
-- ---------------------------------------------------------------------
DELETE FROM public.drivers WHERE user_id = '70a5fcd8-e0cb-4ce5-b3b8-a0b4db36ba35';
DELETE FROM public.user_roles WHERE user_id = '70a5fcd8-e0cb-4ce5-b3b8-a0b4db36ba35';

-- ---------------------------------------------------------------------
-- [071/144] 20260803051751_b629723e-3ea0-4961-9f87-06e8ad861527.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_batch_id uuid;

CREATE TABLE IF NOT EXISTS public.driver_hour_clearings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  cleared_by uuid,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz,
  period_end timestamptz,
  shift_count integer NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric,
  earnings numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_hour_clearings TO authenticated;
GRANT ALL ON public.driver_hour_clearings TO service_role;

ALTER TABLE public.driver_hour_clearings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage hour clearings"
  ON public.driver_hour_clearings FOR ALL
  TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE INDEX IF NOT EXISTS idx_driver_shifts_cleared_batch ON public.driver_shifts(cleared_batch_id);
CREATE INDEX IF NOT EXISTS idx_driver_hour_clearings_driver ON public.driver_hour_clearings(driver_id, cleared_at DESC);

CREATE TRIGGER trg_driver_hour_clearings_updated_at
  BEFORE UPDATE ON public.driver_hour_clearings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [072/144] 20260803061449_e840811d-2996-4a82-a9f9-0063cfa81ee8.sql
-- ---------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_owner';

-- ---------------------------------------------------------------------
-- [073/144] 20260803061605_3c5276f0-4c3d-4140-bdea-e11e15e08f51.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- [074/144] 20260803065653_53c50d40-93f1-4dca-9a83-b046ae6978ae.sql
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- [075/144] 20260808162209_799c4ec1-236e-40ae-86a4-f77c588d9d34.sql
-- ---------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'billing';

CREATE OR REPLACE FUNCTION public.current_user_can_bill()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','billing')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_billing()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'billing'
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_user_can_bill() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_billing() TO authenticated;

-- billing_records
CREATE POLICY "billing_records billing staff all" ON public.billing_records
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- medicaid_trips
CREATE POLICY "medicaid_trips billing read" ON public.medicaid_trips
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "medicaid_trips billing insert" ON public.medicaid_trips
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_bill());
CREATE POLICY "medicaid_trips billing update" ON public.medicaid_trips
  FOR UPDATE TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- medicaid_trip_legs
CREATE POLICY "medicaid_trip_legs billing all" ON public.medicaid_trip_legs
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- riders
CREATE POLICY "riders billing read" ON public.riders
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "riders billing insert" ON public.riders
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_bill());
CREATE POLICY "riders billing update" ON public.riders
  FOR UPDATE TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- rate + settings (read only)
CREATE POLICY "billing_rate_settings billing read" ON public.billing_rate_settings
  FOR SELECT TO authenticated USING (public.current_user_can_bill());
CREATE POLICY "billing_settings billing read" ON public.billing_settings
  FOR SELECT TO authenticated USING (public.current_user_can_bill());

-- audit log
CREATE POLICY "billing_audit_log billing all" ON public.billing_audit_log
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- profiles: billers need driver names inside their company
CREATE POLICY "profiles billing read" ON public.profiles
  FOR SELECT TO authenticated USING (public.current_user_can_bill());

-- storage: proof-of-service documents
CREATE POLICY "Billers manage state pdfs" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'state-pdfs' AND public.current_user_can_bill())
  WITH CHECK (bucket_id = 'state-pdfs' AND public.current_user_can_bill());

CREATE POLICY "Billers read signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND public.current_user_can_bill());

-- only admins may grant/revoke the billing role
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role::text = 'platform_owner'
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
  IF _role::text IN ('driver','dispatch','admin','billing') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ---------------------------------------------------------------------
-- [076/144] 20260809060006_65d31839-c66a-4c30-91ae-517067f94a5d.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS twilio_phone text;
CREATE UNIQUE INDEX IF NOT EXISTS companies_twilio_phone_key ON public.companies (twilio_phone) WHERE twilio_phone IS NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sms_alerts_enabled boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- [077/144] 20260809165707_4a0dc576-fb99-47c9-920f-58366021e5ce.sql
-- ---------------------------------------------------------------------
UPDATE public.companies SET twilio_phone = '+17193949656' WHERE id = '11111111-2222-4333-8444-555555555555';

-- ---------------------------------------------------------------------
-- [078/144] 20260809212237_e648e7d7-e7a2-40ce-971b-2225526a6f22.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_unscoped()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_owner() AND public.current_user_company_id() IS NULL
$$;

REVOKE ALL ON FUNCTION public.owner_unscoped() FROM public;
GRANT EXECUTE ON FUNCTION public.owner_unscoped() TO authenticated, service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_rate_settings','billing_records','driver_shifts','drivers','gas_receipts','medicaid_trips','passengers','ride_requests','riders','routes','state_portal_credentials','trips','user_roles']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public USING (public.owner_unscoped() OR company_id = public.current_user_company_id()) WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id())',
      t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON public.profiles;
CREATE POLICY tenant_isolation ON public.profiles AS RESTRICTIVE FOR ALL TO public
USING (public.owner_unscoped() OR company_id = public.current_user_company_id() OR id = auth.uid())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id() OR id = auth.uid());

-- ---------------------------------------------------------------------
-- [079/144] 20260809212400_b552f4ed-b47a-4dbe-b684-0c1d31b518bb.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public.user_roles;
CREATE POLICY tenant_isolation ON public.user_roles AS RESTRICTIVE FOR ALL TO public
USING (public.owner_unscoped() OR company_id = public.current_user_company_id() OR user_id = auth.uid())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id() OR user_id = auth.uid());

-- ---------------------------------------------------------------------
-- [080/144] 20260809222329_89acfcd1-1842-4bfe-95a2-80ea1016d22e.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.company_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Standard',
  monthly_price numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'trial',
  started_on date NOT NULL DEFAULT current_date,
  renews_on date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_subscriptions TO authenticated;
GRANT ALL ON public.company_subscriptions TO service_role;

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owner manages subscriptions"
  ON public.company_subscriptions FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

CREATE TRIGGER company_subscriptions_set_updated_at
  BEFORE UPDATE ON public.company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  period_start date,
  period_end date,
  paid_on date NOT NULL DEFAULT current_date,
  method text NOT NULL DEFAULT 'other',
  reference text,
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_payments_company_idx ON public.subscription_payments (company_id, paid_on DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owner manages subscription payments"
  ON public.subscription_payments FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

CREATE TRIGGER subscription_payments_set_updated_at
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [081/144] 20260810001312_815e180b-20ce-43cc-b276-681b096583f5.sql
-- ---------------------------------------------------------------------
-- Portal credentials: billing staff get full control (company-scoped by the
-- existing tenant_isolation policy).
CREATE POLICY "portal_credentials billing all"
  ON public.state_portal_credentials
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- Rate settings: billing staff can manage, not just read.
CREATE POLICY "billing_rate_settings billing manage"
  ON public.billing_rate_settings
  FOR ALL TO authenticated
  USING (public.current_user_can_bill())
  WITH CHECK (public.current_user_can_bill());

-- Default portal + credential RPCs: allow billing role in addition to admin.
CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company_id, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_portal_credential(_portal_id text, _portal_name text, _state text, _login_email text, _login_password text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company_id, '00000000-0000-0000-0000-000000000000'::uuid);

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id)
    VALUES
      (_portal_id, _portal_name, _state, _login_email, _new_secret_id, _last4, _company_id)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- [082/144] 20260810002102_7648410f-5b33-4f2a-82ba-ccf3a24814eb.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_drivers integer,
  ADD COLUMN IF NOT EXISTS max_dispatchers integer,
  ADD COLUMN IF NOT EXISTS max_billers integer,
  ADD COLUMN IF NOT EXISTS max_admins integer;

-- ---------------------------------------------------------------------
-- [083/144] 20260810052258_8cee1397-f6af-45db-9305-0f5af4095008.sql
-- ---------------------------------------------------------------------
update public.drivers set current_lat=38.8339, current_lng=-104.8214, last_location_at=now(), status='available' where company_id='63bb7b72-3a44-4487-8899-87d9c337a8ec';

-- ---------------------------------------------------------------------
-- [084/144] 20260811021300_707f0c9a-72cd-4f95-b0d4-684cb558da23.sql
-- ---------------------------------------------------------------------
-- 1) Stamp company on insert so credentials are never orphaned
DROP TRIGGER IF EXISTS state_portal_credentials_stamp_company ON public.state_portal_credentials;
CREATE TRIGGER state_portal_credentials_stamp_company
BEFORE INSERT ON public.state_portal_credentials
FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_portal_credentials TO authenticated;
GRANT ALL ON public.state_portal_credentials TO service_role;

-- 2) Default the company to the caller's own company in the upsert RPC
CREATE OR REPLACE FUNCTION public.upsert_portal_credential(_portal_id text, _portal_name text, _state text, _login_email text, _login_password text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
  _company UUID;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  _company := COALESCE(_company_id, public.current_user_company_id());
  IF _company IS DISTINCT FROM public.current_user_company_id()
     AND public.current_user_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'cannot manage another company''s credentials';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company, '00000000-0000-0000-0000-000000000000'::uuid);

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id)
    VALUES
      (_portal_id, _portal_name, _state, _login_email, _new_secret_id, _last4, _company)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;

-- 3) Same defaulting for the billing default-portal setting
CREATE OR REPLACE FUNCTION public.set_default_billing_portal(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _company UUID;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  _company := COALESCE(_company_id, public.current_user_company_id());

  INSERT INTO public.billing_settings (company_id, default_portal_id)
  VALUES (_company, _portal_id)
  ON CONFLICT (company_id) DO UPDATE
    SET default_portal_id = EXCLUDED.default_portal_id,
        updated_at = now();
END;
$function$;

-- 4) Re-home the orphaned credential row to Walla Investment LLC
UPDATE public.state_portal_credentials
   SET company_id = '11111111-2222-4333-8444-555555555555'
 WHERE company_id IS NULL;

-- 5) Same for any orphaned billing settings row
UPDATE public.billing_settings
   SET company_id = '11111111-2222-4333-8444-555555555555'
 WHERE company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.billing_settings b2
      WHERE b2.company_id = '11111111-2222-4333-8444-555555555555'
   );
DELETE FROM public.billing_settings WHERE company_id IS NULL;

-- ---------------------------------------------------------------------
-- [085/144] 20260811023810_5a8c7d0a-5902-44ec-ba9b-2a09a417c443.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.passengers DROP CONSTRAINT IF EXISTS passengers_medicaid_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS passengers_company_medicaid_key
  ON public.passengers (company_id, medicaid_id)
  WHERE medicaid_id IS NOT NULL;
DROP INDEX IF EXISTS public.passengers_device_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS passengers_device_id_key
  ON public.passengers (device_id);

-- ---------------------------------------------------------------------
-- [086/144] 20260811041849_9df70751-5218-4bf5-85cf-d67b6dc6a415.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.medicaid_trips ADD COLUMN IF NOT EXISTS paper_driver_name text;

-- ---------------------------------------------------------------------
-- [087/144] 20260811045713_cb03d837-3776-4c97-955c-1978b1067590.sql
-- ---------------------------------------------------------------------
-- 1. Remove older duplicates, keeping the most recently updated row per
--    (company_id, vehicle_type, unit_type).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, vehicle_type, unit_type
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
    FROM public.billing_rate_settings
   WHERE company_id IS NOT NULL
)
DELETE FROM public.billing_rate_settings b
 USING ranked r
 WHERE b.id = r.id AND r.rn > 1;

-- Same treatment for any legacy rows with no company set.
WITH ranked_null AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vehicle_type, unit_type
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
    FROM public.billing_rate_settings
   WHERE company_id IS NULL
)
DELETE FROM public.billing_rate_settings b
 USING ranked_null r
 WHERE b.id = r.id AND r.rn > 1;

-- 2. Structural guarantee: one rate row per company + vehicle type + unit type.
CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_company_vehicle_unit_key
  ON public.billing_rate_settings (company_id, vehicle_type, unit_type)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_nocompany_vehicle_unit_key
  ON public.billing_rate_settings (vehicle_type, unit_type)
  WHERE company_id IS NULL;

-- 3. Also make the exact combination requested unique (implied by the above,
--    but explicit so a procedure-code change can never fork a second row).
CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_company_vehicle_unit_proc_key
  ON public.billing_rate_settings (company_id, vehicle_type, unit_type, procedure_code)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- [088/144] 20260812062005_6a36b945-1153-49bb-9935-fbf8e80d3c7b.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended). The automation timed out waiting for the page after clicking Confirm.',
    robot_last_checked_at = now()
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

INSERT INTO public.billing_audit_log (billing_record_id, action, actor_type, notes)
SELECT id, 'manual_reconcile_submitted', 'system',
  'False failure: robot clicked Confirm successfully, then timed out waiting for navigation. Portal receipt screenshot shows claim 9426224001006 submitted (status Suspended). Reconciled to submitted; retry blocked.'
FROM public.billing_records
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

-- ---------------------------------------------------------------------
-- [089/144] 20260812062059_c4899c76-23a8-4bc2-9198-f57d7ee3ca34.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended). Automation timed out waiting for the page after clicking Confirm.',
    robot_last_checked_at = now()
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

-- ---------------------------------------------------------------------
-- [090/144] 20260812062137_3532d335-effe-49d2-b714-2e38cd808eb0.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended).',
    robot_last_checked_at = now()
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

-- ---------------------------------------------------------------------
-- [091/144] 20260812062408_9ee7ac82-54ca-43a1-8131-186d345f3126.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended).',
    robot_last_checked_at = now()
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

-- ---------------------------------------------------------------------
-- [092/144] 20260812062625_241cbe2f-d9c2-4b6a-8f4d-64534e677b2c.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_submitted_claims()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.submitted_confirmation, OLD.robot_confirmation_number) IS NOT NULL THEN
    NEW.submitted_confirmation := COALESCE(NEW.submitted_confirmation, OLD.submitted_confirmation);
    NEW.robot_confirmation_number := COALESCE(NEW.robot_confirmation_number, OLD.robot_confirmation_number);
    NEW.portal_confirmation := COALESCE(NEW.portal_confirmation, OLD.portal_confirmation);
    NEW.status := 'submitted';
    NEW.portal_status := 'submitted';
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    IF NEW.robot_last_status IS DISTINCT FROM 'SUBMITTED' THEN
      NEW.robot_last_status := 'SUBMITTED';
      NEW.robot_last_message := 'Claim already exists at the portal (confirmation #'
        || COALESCE(NEW.submitted_confirmation, NEW.robot_confirmation_number) || ').';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_submitted_claims ON public.medicaid_trips;
CREATE TRIGGER trg_protect_submitted_claims
BEFORE UPDATE ON public.medicaid_trips
FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_claims();

CREATE OR REPLACE FUNCTION public.protect_submitted_billing_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.state_confirmation_number IS NOT NULL THEN
    NEW.state_confirmation_number := COALESCE(NEW.state_confirmation_number, OLD.state_confirmation_number);
    NEW.status := 'submitted';
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    NEW.submission_error := NULL;
    NEW.fix_notes := NULL;
    NEW.requires_human_step := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_submitted_billing_records ON public.billing_records;
CREATE TRIGGER trg_protect_submitted_billing_records
BEFORE UPDATE ON public.billing_records
FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_billing_records();

UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended).'
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';

-- ---------------------------------------------------------------------
-- [093/144] 20260813043128_a870e62c-f14a-42fc-b8a9-15514067912b.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public.medicaid_trip_legs;
CREATE POLICY tenant_isolation ON public.medicaid_trip_legs
AS RESTRICTIVE
FOR ALL
USING (
  public.owner_unscoped() OR EXISTS (
    SELECT 1 FROM public.medicaid_trips t
    WHERE t.id = medicaid_trip_legs.medicaid_trip_id
      AND t.company_id = public.current_user_company_id()
  )
)
WITH CHECK (
  public.owner_unscoped() OR EXISTS (
    SELECT 1 FROM public.medicaid_trips t
    WHERE t.id = medicaid_trip_legs.medicaid_trip_id
      AND t.company_id = public.current_user_company_id()
  )
);

-- ---------------------------------------------------------------------
-- [094/144] 20260813051501_e4704485-4420-4310-87bf-f086cbd57ef2.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records DROP CONSTRAINT IF EXISTS billing_records_status_check;
ALTER TABLE public.billing_records ADD CONSTRAINT billing_records_status_check CHECK (status = ANY (ARRAY['pending_review','pending_submit','submitting','submitted','approved','rejected','needs_fix','paid','suspended','denied']));

CREATE OR REPLACE FUNCTION public.protect_submitted_billing_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.state_confirmation_number IS NOT NULL THEN
    NEW.state_confirmation_number := COALESCE(NEW.state_confirmation_number, OLD.state_confirmation_number);
    -- Allow billing staff to record the real portal outcome; otherwise keep it submitted.
    IF NEW.status IS NULL OR NEW.status NOT IN ('submitted','paid','suspended','rejected','denied','approved') THEN
      NEW.status := 'submitted';
    END IF;
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    NEW.submission_error := NULL;
    NEW.fix_notes := NULL;
    NEW.requires_human_step := false;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- [095/144] 20260813151754_ab20c362-be88-468b-8c2c-26f2d7fbc208.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records DROP CONSTRAINT IF EXISTS billing_records_status_check;
ALTER TABLE public.billing_records ADD CONSTRAINT billing_records_status_check CHECK (status = ANY (ARRAY['pending_review'::text,'pending_submit'::text,'queued'::text,'submitting'::text,'submitted'::text,'approved'::text,'rejected'::text,'needs_fix'::text,'paid'::text,'suspended'::text,'denied'::text]));

-- ---------------------------------------------------------------------
-- [096/144] 20260813172001_7b3857f9-8a7e-4eb5-998a-e16dded8f054.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  -- Fail closed: a portal login is company-owned. No default / NULL-company
  -- fallback, and never another company's credential.
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required: portal logins are never shared between companies';
  END IF;

  RETURN QUERY
  SELECT credential.portal_id,
         credential.portal_name,
         credential.state,
         credential.login_email,
         decrypted.decrypted_secret AS login_password
    FROM public.state_portal_credentials AS credential
    LEFT JOIN vault.decrypted_secrets AS decrypted
      ON decrypted.id = credential.password_secret_id
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id
   LIMIT 1;

  UPDATE public.state_portal_credentials AS credential
     SET last_used_at = now()
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- [097/144] 20260813173025_ed3313ac-5649-4988-adf0-096bdea8503f.sql
-- ---------------------------------------------------------------------
UPDATE public.state_portal_credentials
SET company_id = '9c0446b4-6143-4053-9234-a35206f22eba', updated_at = now()
WHERE id = 'c8a01de2-e698-4f43-a2fb-02aca61a4f90';

-- ---------------------------------------------------------------------
-- [098/144] 20260815041335_b2e1e17e-3572-4d8c-a58b-e20e73ff56a5.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Verified from portal Claim Receipt (08/14/2026 10:09 PM MST): Professional Claim successfully submitted, status Paid. Claim ID 2326226001803.',
    robot_confirmation_number = '2326226001803',
    submitted_confirmation = '2326226001803',
    portal_confirmation = '2326226001803',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-15T04:09:38.884Z',
    submitted_at = '2026-08-15T04:09:38.884Z'
WHERE id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '2326226001803',
    submitted_at = '2026-08-15T04:09:38.884Z',
    submission_error = NULL,
    requires_human_step = false
WHERE trip_id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';

INSERT INTO public.billing_audit_log (billing_record_id, action, actor_type, notes)
SELECT id, 'manual_confirmation_recorded', 'system',
       'Unverified submit resolved by read-only portal receipt review: Claim ID 2326226001803, status Paid. No resubmission performed.'
FROM public.billing_records
WHERE trip_id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';

-- ---------------------------------------------------------------------
-- [099/144] 20260815081825_3f87ce75-15be-4e9c-8b32-48cc4ad68d88.sql
-- ---------------------------------------------------------------------
UPDATE public.medicaid_trips
SET status = 'submitted',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Resolved by read-only portal receipt lookup: Claim ID 2326227001003, portal status Paid. Not resubmitted.',
    robot_last_checked_at = now(),
    robot_confirmation_number = '2326227001003',
    submitted_confirmation = '2326227001003',
    portal_confirmation = '2326227001003',
    portal_status = 'submitted',
    portal_submitted_at = now(),
    submitted_at = COALESCE(submitted_at, now()),
    updated_at = now()
WHERE id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '2326227001003',
    submitted_at = COALESCE(submitted_at, now()),
    submission_error = NULL,
    requires_human_step = false,
    updated_at = now()
WHERE trip_id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';

INSERT INTO public.billing_audit_log (billing_record_id, action, actor_type, notes)
SELECT id, 'manual_portal_lookup_resolved', 'system',
       'Job ended SUBMITTED_UNVERIFIED. Read-only portal receipt confirmed Claim ID 2326227001003 (status Paid) for Pablo Soto / L085312. Record resolved without resubmitting.'
FROM public.billing_records WHERE trip_id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';

-- ---------------------------------------------------------------------
-- [100/144] 20260817215927_ecb8be80-3d07-48a5-993c-4e11708f36ff.sql
-- ---------------------------------------------------------------------
delete from public.billing_records where trip_id='aa47a3c3-6525-431f-8753-e4d103fbbd55';
delete from public.medicaid_trips where id='aa47a3c3-6525-431f-8753-e4d103fbbd55';
delete from public.riders where full_name='ZZ TEST PASSENGER';
delete from public.passengers where first_name='ZZ' and last_name='TEST PASSENGER';

-- ---------------------------------------------------------------------
-- [101/144] 20260818153317_141db360-935e-42a4-8fdb-4edad64b9324.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.driver_pay ADD COLUMN IF NOT EXISTS payout_percentage numeric;

CREATE TABLE IF NOT EXISTS public.driver_claim_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_billed numeric NOT NULL DEFAULT 0,
  percentage_used numeric NOT NULL,
  payout_amount numeric NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_claim_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_claim_payouts(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  trip_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_claim_payout_items_trip_once UNIQUE (trip_id)
);

CREATE INDEX IF NOT EXISTS driver_claim_payouts_driver_idx ON public.driver_claim_payouts(driver_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS driver_claim_payout_items_payout_idx ON public.driver_claim_payout_items(payout_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_claim_payouts TO authenticated;
GRANT ALL ON public.driver_claim_payouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_claim_payout_items TO authenticated;
GRANT ALL ON public.driver_claim_payout_items TO service_role;

ALTER TABLE public.driver_claim_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_claim_payout_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER driver_claim_payouts_stamp_company
  BEFORE INSERT ON public.driver_claim_payouts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

CREATE TRIGGER driver_claim_payouts_set_updated_at
  BEFORE UPDATE ON public.driver_claim_payouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Billing staff manage payouts in their company"
  ON public.driver_claim_payouts FOR ALL TO authenticated
  USING (public.current_user_can_bill() AND company_id = public.current_user_company_id())
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id()));

CREATE POLICY "Drivers can view their own payouts"
  ON public.driver_claim_payouts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()));

CREATE POLICY "Billing staff manage payout items in their company"
  ON public.driver_claim_payout_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.driver_claim_payouts p
     WHERE p.id = payout_id
       AND public.current_user_can_bill()
       AND p.company_id = public.current_user_company_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.driver_claim_payouts p
     WHERE p.id = payout_id
       AND public.current_user_can_bill()
       AND p.company_id = public.current_user_company_id()));

-- ---------------------------------------------------------------------
-- [102/144] 20260818194147_a57d4e19-70b2-4941-a1bc-bf1c55eb373c.sql
-- ---------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin_biller';

-- ---------------------------------------------------------------------
-- [103/144] 20260818194234_c84c9703-da9f-4e28-b80b-3da1aa3cba4b.sql
-- ---------------------------------------------------------------------
-- 1. Track who created each Medicaid trip / paper bill
ALTER TABLE public.medicaid_trips ADD COLUMN IF NOT EXISTS created_by uuid;
UPDATE public.medicaid_trips SET created_by = driver_id WHERE created_by IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_medicaid_trip_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.driver_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_medicaid_trip_creator() FROM anon, authenticated;

DROP TRIGGER IF EXISTS stamp_medicaid_trip_creator ON public.medicaid_trips;
CREATE TRIGGER stamp_medicaid_trip_creator
BEFORE INSERT ON public.medicaid_trips
FOR EACH ROW EXECUTE FUNCTION public.stamp_medicaid_trip_creator();

CREATE INDEX IF NOT EXISTS medicaid_trips_created_by_idx ON public.medicaid_trips (created_by);

-- 2. Role helpers
CREATE OR REPLACE FUNCTION public.current_user_can_bill()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','billing','admin_biller')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_sees_all_bills()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','admin_biller','platform_owner')
  )
$$;
GRANT EXECUTE ON FUNCTION public.current_user_sees_all_bills() TO authenticated, service_role;

-- 3. Scope plain billers to their own entries
DROP POLICY IF EXISTS "medicaid_trips billing read" ON public.medicaid_trips;
CREATE POLICY "medicaid_trips billing read" ON public.medicaid_trips
FOR SELECT TO authenticated
USING (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "medicaid_trips billing update" ON public.medicaid_trips;
CREATE POLICY "medicaid_trips billing update" ON public.medicaid_trips
FOR UPDATE TO authenticated
USING (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
)
WITH CHECK (
  public.current_user_can_bill()
  AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "billing_records billing staff all" ON public.billing_records;
CREATE POLICY "billing_records billing staff all" ON public.billing_records
FOR ALL TO authenticated
USING (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
)
WITH CHECK (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "medicaid_trip_legs billing all" ON public.medicaid_trip_legs;
CREATE POLICY "medicaid_trip_legs billing all" ON public.medicaid_trip_legs
FOR ALL TO authenticated
USING (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR medicaid_trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
)
WITH CHECK (
  public.current_user_can_bill()
  AND (
    public.current_user_sees_all_bills()
    OR medicaid_trip_id IN (SELECT id FROM public.medicaid_trips WHERE created_by = auth.uid())
  )
);

-- 4. Let admins manage the new role
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role := COALESCE(NEW.role, OLD.role);
BEGIN
  IF _role::text = 'platform_owner'
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
  IF _role::text IN ('driver','dispatch','admin','billing','admin_biller') AND NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator may grant or modify privileged roles';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------
-- [104/144] 20260818200840_e0a2d605-134c-4106-abd3-ea459b7b056b.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.staff_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  member_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_conversations_distinct_members CHECK (member_a <> member_b)
);

CREATE UNIQUE INDEX staff_conversations_pair_idx
  ON public.staff_conversations (company_id, LEAST(member_a, member_b), GREATEST(member_a, member_b));

CREATE TABLE public.staff_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.staff_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_messages_conversation_idx ON public.staff_messages (conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_conversations TO authenticated;
GRANT ALL ON public.staff_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.staff_messages TO authenticated;
GRANT ALL ON public.staff_messages TO service_role;

ALTER TABLE public.staff_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staff_conversation_member(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_conversations c
    WHERE c.id = _conversation_id
      AND auth.uid() IN (c.member_a, c.member_b)
  )
$$;

CREATE POLICY "Members can view their staff conversations"
  ON public.staff_conversations FOR SELECT TO authenticated
  USING (auth.uid() IN (member_a, member_b));

CREATE POLICY "Billing staff can start a conversation they are in"
  ON public.staff_conversations FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IN (member_a, member_b)
    AND public.current_user_can_bill()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "Members can view their staff messages"
  ON public.staff_messages FOR SELECT TO authenticated
  USING (public.is_staff_conversation_member(conversation_id));

CREATE POLICY "Members can send staff messages"
  ON public.staff_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_staff_conversation_member(conversation_id));

CREATE POLICY "Members can mark staff messages read"
  ON public.staff_messages FOR UPDATE TO authenticated
  USING (public.is_staff_conversation_member(conversation_id))
  WITH CHECK (public.is_staff_conversation_member(conversation_id));

CREATE OR REPLACE FUNCTION public.bump_staff_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.staff_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_messages_bump
AFTER INSERT ON public.staff_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_staff_conversation();

CREATE TRIGGER staff_conversations_set_updated_at
BEFORE UPDATE ON public.staff_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [105/144] 20260818201039_93462898-9bd2-4306-8783-1cabda03ea84.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS unit_number text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vehicle_vin text;

-- ---------------------------------------------------------------------
-- [106/144] 20260818201313_f36ec687-6e24-4031-9e2a-980b8640dc33.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_staff_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.staff_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- [107/144] 20260819030209_af8017e1-c71b-4ae0-88de-ee98c4ff4e7c.sql
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- [108/144] 20260819030251_ef0aa165-7f01-482b-9c0b-2c685b15ecc1.sql
-- ---------------------------------------------------------------------
DELETE FROM public.passengers p
WHERE p.user_id IS NULL
  AND p.medicaid_id LIKE 'SELF-%'
  AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_entries c WHERE c.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_winners w WHERE w.passenger_id = p.id);

-- ---------------------------------------------------------------------
-- [109/144] 20260819030902_81a52a78-a0a3-47dc-a1e8-0f3fd27abe5a.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS bonus_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_note text;

ALTER TABLE public.driver_claim_payouts
  ADD COLUMN IF NOT EXISTS extra_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_note text;

-- ---------------------------------------------------------------------
-- [110/144] 20260819031549_a72710e1-8dea-4afd-9358-c98f5af74d80.sql
-- ---------------------------------------------------------------------
DELETE FROM public.driver_payouts WHERE bonus_note = 'test bonus';

DELETE FROM public.driver_shifts ds
USING public.drivers d, public.profiles p
WHERE ds.driver_id = d.id AND d.user_id = p.id
  AND upper(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE 'YIBRAH%'
  AND ds.clock_in_at::date = DATE '2026-08-10';

DELETE FROM public.driver_pay dp
USING public.drivers d, public.profiles p
WHERE dp.driver_id = d.id AND d.user_id = p.id
  AND upper(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE 'YIBRAH%'
  AND dp.hourly_rate = 20;

-- ---------------------------------------------------------------------
-- [111/144] 20260819155211_520ba668-152d-46e4-a22b-09387c9f0e2a.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_status_raw text;

CREATE TABLE IF NOT EXISTS public.claim_status_sync_state (
  id boolean PRIMARY KEY DEFAULT true,
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.claim_status_sync_state TO authenticated;
GRANT ALL ON public.claim_status_sync_state TO service_role;

ALTER TABLE public.claim_status_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_status_sync_state readable by billing staff" ON public.claim_status_sync_state;
CREATE POLICY "claim_status_sync_state readable by billing staff"
  ON public.claim_status_sync_state FOR SELECT TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'));

INSERT INTO public.claim_status_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS billing_records_status_check_idx
  ON public.billing_records (status_checked_at NULLS FIRST)
  WHERE state_confirmation_number IS NOT NULL;

-- ---------------------------------------------------------------------
-- [112/144] 20260819155525_821bb0d5-77f3-46b1-83c3-f63bb5cad4d2.sql
-- ---------------------------------------------------------------------
-- EXCEPTION 1: the following statements are intentionally commented out
-- for the mirror target (see header). Extensions are kept active.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.unschedule('sync-claim-status') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-claim-status');
--
-- SELECT cron.schedule(
--   'sync-claim-status',
--   '20 */6 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://project--1c3c174b-6cbe-4b49-974e-a1f94a0d4813.lovable.app/api/public/hooks/sync-claim-status',
--     headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYWJnZmFtaHplc3dsdmloZGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjcwNjAsImV4cCI6MjA5ODYwMzA2MH0.bnZHII0kG4Pj57Afwxvl8tUPkh_CjrNjdj_IzhDO2xg"}'::jsonb,
--     body := '{"source": "cron"}'::jsonb
--   );
--   $$
-- );

-- ---------------------------------------------------------------------
-- [113/144] 20260821162517_881ff1b6-cc7b-4136-8cdb-907b9ce9df10.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- [114/144] 20260822174748_39f442ab-11f9-497a-9e07-cbdd9d799be6.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_check_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_check_error text;

CREATE INDEX IF NOT EXISTS billing_records_status_check_due_idx
  ON public.billing_records (status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Backfill: any already-submitted claim with a portal claim number becomes due now.
UPDATE public.billing_records
SET status_check_next_at = now()
WHERE status_check_next_at IS NULL
  AND state_confirmation_number IS NOT NULL
  AND status IN ('submitted','approved','suspended');

-- ---------------------------------------------------------------------
-- [115/144] 20260822181705_15cd62bd-9fa6-4306-8fe9-9e43911a47b8.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS billing_records_status_check_lock_idx
  ON public.billing_records (status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Recover any lease left behind by a run that was cut off mid-flight.
UPDATE public.claim_status_sync_state
  SET lease_until = NULL, updated_at = now()
  WHERE id = true;

-- ---------------------------------------------------------------------
-- [116/144] 20260822183026_5ed6418c-077d-4ce3-aa76-b4a7e6cb06ba.sql
-- ---------------------------------------------------------------------

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_check_last_ms integer,
  ADD COLUMN IF NOT EXISTS status_check_worker text;

CREATE INDEX IF NOT EXISTS billing_records_status_check_lease_idx
  ON public.billing_records (company_id, status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Atomic, fair, per-company bounded leasing of read-only claim-status jobs.
CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit integer,
  _per_company_limit integer,
  _lease_seconds integer,
  _worker text DEFAULT NULL,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  company_id uuid,
  status text,
  status_check_attempts integer,
  claim_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT br.id, br.trip_id, br.company_id, br.status,
           coalesce(br.status_check_attempts, 0) AS attempts,
           nullif(btrim(coalesce(br.state_confirmation_number,
                                 mt.robot_confirmation_number,
                                 mt.submitted_confirmation, '')), '') AS claim_number,
           br.status_check_next_at,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY br.status_check_next_at NULLS FIRST, br.created_at
           ) AS rn
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND br.status_check_next_at IS NOT NULL
          AND br.status_check_next_at <= now()
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= greatest(_per_company_limit, 1)
    ORDER BY d.status_check_next_at NULLS FIRST
    LIMIT greatest(_global_limit, 1)
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => greatest(_lease_seconds, 30)),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(integer, integer, integer, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_claim_status_jobs(integer, integer, integer, text, uuid[]) TO service_role;

-- Queryable per-company queue metrics for observability.
CREATE OR REPLACE VIEW public.claim_status_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL
                     AND br.status_check_next_at <= now()
                     AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())) AS due_now,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL
                     AND br.status_check_locked_until >= now()) AS leased_running,
  count(*) FILTER (WHERE coalesce(br.status_check_attempts, 0) > 0
                     AND br.status_check_next_at IS NOT NULL) AS retrying,
  count(*) FILTER (WHERE br.status IN ('paid','denied','rejected')) AS terminal,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL) AS scheduled_total,
  avg(br.status_check_last_ms) FILTER (WHERE br.status_check_last_ms IS NOT NULL) AS avg_check_ms,
  max(br.status_checked_at) AS last_checked_at
FROM public.billing_records br
GROUP BY br.company_id;

GRANT SELECT ON public.claim_status_queue_metrics TO authenticated;
GRANT ALL ON public.claim_status_queue_metrics TO service_role;

-- ---------------------------------------------------------------------
-- [117/144] 20260822184033_35743d79-ca8b-49b8-8c4b-3a2d51fea131.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit int DEFAULT 20,
  _per_company_limit int DEFAULT 4,
  _lease_seconds int DEFAULT 180,
  _worker text DEFAULT NULL,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  company_id uuid,
  status text,
  status_check_attempts integer,
  claim_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT br.id, br.trip_id, br.company_id, br.status::text AS status,
           coalesce(br.status_check_attempts, 0) AS attempts,
           nullif(btrim(coalesce(br.state_confirmation_number,
                                 mt.robot_confirmation_number,
                                 mt.submitted_confirmation, '')), '') AS claim_number,
           br.status_check_next_at,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY br.status_check_next_at NULLS FIRST, br.created_at
           ) AS rn
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND br.status_check_next_at IS NOT NULL
          AND br.status_check_next_at <= now()
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= greatest(_per_company_limit, 1)
    ORDER BY d.status_check_next_at NULLS FIRST
    LIMIT greatest(_global_limit, 1)
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => greatest(_lease_seconds, 30)),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      -- Re-checked under the row lock: a tick that lost the race sees the
      -- winner's lease here and simply leases nothing for this row.
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) TO service_role;

-- ---------------------------------------------------------------------
-- [118/144] 20260822201033_607fdbaa-d970-4e02-b9bb-e281d8240f47.sql
-- ---------------------------------------------------------------------
-- 1) Fair, clamped, atomic leasing ------------------------------------------
CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 180,
  _worker text DEFAULT NULL::text,
  _record_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, status text, status_check_attempts integer, claim_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g   integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc  integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls  integer := least(greatest(coalesce(_lease_seconds, 180), 30), 3600);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT br.id, br.trip_id, br.company_id, br.status::text AS status,
           coalesce(br.status_check_attempts, 0) AS attempts,
           nullif(btrim(coalesce(br.state_confirmation_number,
                                 mt.robot_confirmation_number,
                                 mt.submitted_confirmation, '')), '') AS claim_number,
           br.status_check_next_at,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY br.status_check_next_at NULLS FIRST, br.created_at
           ) AS rn
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND br.status_check_next_at IS NOT NULL
          AND br.status_check_next_at <= now()
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= pc
    -- Round-robin across companies FIRST: every company gets its 1st slot
    -- before any company gets its 2nd. A company with hundreds of due
    -- claims can never consume the whole global batch.
    ORDER BY d.rn, d.status_check_next_at NULLS FIRST
    LIMIT g
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => ls),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      -- Re-checked under the row lock (EvalPlanQual): a tick that lost the
      -- race sees the winner's lease here and leases nothing for this row.
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$function$;

-- 2) Operations / metrics surface -------------------------------------------
DROP VIEW IF EXISTS public.claim_status_queue_metrics;
CREATE VIEW public.claim_status_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  c.name AS company_name,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now()
                     AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())) AS due_now,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL AND br.status_check_locked_until >= now()) AS leased_running,
  count(*) FILTER (WHERE coalesce(br.status_check_attempts, 0) > 0 AND br.status_check_next_at IS NOT NULL) AS retrying,
  count(*) FILTER (WHERE br.status_check_error IS NOT NULL) AS errored,
  count(*) FILTER (WHERE br.status = ANY (ARRAY['paid','denied','rejected'])) AS terminal,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL) AS scheduled_total,
  count(*) FILTER (WHERE br.status_checked_at IS NOT NULL AND br.status_checked_at >= now() - interval '1 hour') AS checked_last_hour,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL
                     AND br.status_check_locked_until < now() - interval '30 minutes') AS stale_locks,
  avg(br.status_check_last_ms) FILTER (WHERE br.status_check_last_ms IS NOT NULL) AS avg_check_ms,
  min(br.status_check_next_at) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now()) AS oldest_due_at,
  max(br.status_checked_at) AS last_checked_at
FROM public.billing_records br
LEFT JOIN public.companies c ON c.id = br.company_id
GROUP BY br.company_id, c.name;

GRANT SELECT ON public.claim_status_queue_metrics TO authenticated;
GRANT SELECT ON public.claim_status_queue_metrics TO service_role;

-- 3) Self-healing sweep: release leases abandoned by a crashed worker -------
CREATE OR REPLACE FUNCTION public.release_stale_claim_status_locks(_grace_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.billing_records
  SET status_check_locked_until = NULL,
      status_check_worker = NULL
  WHERE status_check_locked_until IS NOT NULL
    AND status_check_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stale_claim_status_locks(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_claim_status_locks(integer) TO service_role;

-- ---------------------------------------------------------------------
-- [119/144] 20260823002035_60b05e25-6341-4205-8a0b-297b311fa330.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS submit_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS submit_lease_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS submit_worker text,
  ADD COLUMN IF NOT EXISTS submit_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submit_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS submit_last_error text,
  ADD COLUMN IF NOT EXISTS submit_last_ms integer;

CREATE INDEX IF NOT EXISTS billing_records_submit_queue_idx
  ON public.billing_records (status, submit_next_attempt_at, submit_locked_until);

CREATE TABLE IF NOT EXISTS public.submission_queue_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_by uuid,
  last_run_at timestamptz,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.submission_queue_state TO authenticated;
GRANT ALL ON public.submission_queue_state TO service_role;
ALTER TABLE public.submission_queue_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing staff read submission queue state" ON public.submission_queue_state;
CREATE POLICY "billing staff read submission queue state"
  ON public.submission_queue_state FOR SELECT TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "billing staff pause submission queue" ON public.submission_queue_state;
CREATE POLICY "billing staff pause submission queue"
  ON public.submission_queue_state FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "billing staff seed submission queue state" ON public.submission_queue_state;
CREATE POLICY "billing staff seed submission queue state"
  ON public.submission_queue_state FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'));

INSERT INTO public.submission_queue_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lease_submission_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 300,
  _worker text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _stale_seconds integer DEFAULT 720,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g  integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls integer := least(greatest(coalesce(_lease_seconds, 300), 30), 3600);
  st integer := least(greatest(coalesce(_stale_seconds, 720), 60), 7200);
  scope uuid := _company_id;
BEGIN
  -- Tenant isolation: only the platform (service role) may lease across
  -- companies. Any signed-in caller is pinned to its own company.
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT br.company_id AS cid, count(*)::int AS n
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
     GROUP BY br.company_id
  ),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY coalesce(br.submit_next_attempt_at, br.updated_at), br.created_at
           ) AS rn
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  picked AS (
    SELECT d.id, d.trip_id, d.company_id, d.attempt, d.rn
      FROM due d
      LEFT JOIN active a ON a.cid IS NOT DISTINCT FROM d.company_id
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     -- Round-robin: every company gets its first slot before any company
     -- gets its second, so one tenant with 1000 bills cannot starve another.
     ORDER BY d.rn, d.company_id, d.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_worker = _worker
      FROM picked p
     WHERE br.id = p.id
       AND br.status = 'queued'
       -- Re-checked under the row lock (EvalPlanQual): a dispatcher that lost
       -- the race leases nothing for this row.
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_stale_submission_locks(_grace_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.billing_records
     SET submit_locked_until = NULL,
         submit_worker = NULL
   WHERE submit_locked_until IS NOT NULL
     AND submit_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60))
     AND status = 'queued';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stale_submission_locks(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_submission_locks(integer) TO authenticated, service_role;

DROP VIEW IF EXISTS public.submission_queue_metrics;
CREATE VIEW public.submission_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  c.name AS company_name,
  count(*) FILTER (WHERE br.status = 'queued')                                        AS queued,
  count(*) FILTER (WHERE br.status = 'queued' AND br.submit_next_attempt_at > now())  AS retrying,
  count(*) FILTER (WHERE br.status = 'submitting')                                    AS processing,
  count(*) FILTER (WHERE br.status = 'queued' AND br.submit_locked_until > now())     AS leased,
  count(*) FILTER (WHERE br.status = 'needs_fix')                                     AS needs_attention,
  count(*) FILTER (WHERE br.status = 'submitted'
                     AND br.submitted_at > now() - interval '1 hour')                 AS submitted_last_hour,
  count(*) FILTER (WHERE br.status = 'queued'
                     AND br.submit_locked_until < now() - interval '15 minutes')      AS stale_locks,
  min(br.updated_at) FILTER (WHERE br.status = 'queued')                              AS oldest_queued_at,
  avg(br.submit_last_ms) FILTER (WHERE br.submit_last_ms IS NOT NULL)                 AS avg_submit_ms,
  max(br.submitted_at)                                                                AS last_submitted_at
FROM public.billing_records br
LEFT JOIN public.companies c ON c.id = br.company_id
GROUP BY br.company_id, c.name;

GRANT SELECT ON public.submission_queue_metrics TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- [120/144] 20260823002634_48c5bacd-e4b0-4223-b939-3cdc26391303.sql
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lease_submission_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 300,
  _worker text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _stale_seconds integer DEFAULT 720,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g  integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls integer := least(greatest(coalesce(_lease_seconds, 300), 30), 3600);
  st integer := least(greatest(coalesce(_stale_seconds, 720), 60), 7200);
  scope uuid := _company_id;
BEGIN
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH busy AS (
    -- Live portal sessions ...
    SELECT br.company_id AS cid
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on, so two
    -- dispatchers running at the same time can never exceed the caps together.
    SELECT br.company_id
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT cid, count(*)::int AS n FROM busy GROUP BY cid),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY coalesce(br.submit_next_attempt_at, br.updated_at), br.created_at
           ) AS rn
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  picked AS (
    SELECT d.id, d.trip_id, d.company_id, d.attempt, d.rn
      FROM due d
      LEFT JOIN active a ON a.cid IS NOT DISTINCT FROM d.company_id
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY d.rn, d.company_id, d.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_worker = _worker
      FROM picked p
     WHERE br.id = p.id
       AND br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- [121/144] 20260823014714_60eeaecd-fce2-4f34-9690-7bee39eb05d4.sql
-- ---------------------------------------------------------------------
-- Robot worker fleet registry -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.robot_workers (
  id text PRIMARY KEY,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_active_jobs integer NOT NULL DEFAULT 20,
  last_health_ok_at timestamptz,
  last_health_error text,
  failure_streak integer NOT NULL DEFAULT 0,
  unhealthy_until timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.robot_workers TO authenticated;
GRANT ALL ON public.robot_workers TO service_role;
ALTER TABLE public.robot_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing staff can read robot workers" ON public.robot_workers;
CREATE POLICY "billing staff can read robot workers"
ON public.robot_workers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.current_user_can_bill());

-- Health bookkeeping is written by background workers running as any billing
-- session, so it goes through a definer function instead of a write policy.
CREATE OR REPLACE FUNCTION public.record_robot_worker_health(
  _id text,
  _base_url text,
  _ok boolean,
  _error text DEFAULT NULL,
  _cooldown_seconds integer DEFAULT 120
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.robot_workers (id, base_url)
  VALUES (_id, _base_url)
  ON CONFLICT (id) DO NOTHING;

  IF _ok THEN
    UPDATE public.robot_workers
       SET last_health_ok_at = now(),
           last_health_error = NULL,
           failure_streak = 0,
           unhealthy_until = NULL,
           updated_at = now()
     WHERE id = _id;
  ELSE
    UPDATE public.robot_workers
       SET failure_streak = failure_streak + 1,
           last_health_error = left(coalesce(_error, 'unknown error'), 500),
           unhealthy_until = now() + make_interval(secs => greatest(30, least(3600, _cooldown_seconds))),
           updated_at = now()
     WHERE id = _id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_robot_worker_health(text, text, boolean, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.record_robot_worker_health(text, text, boolean, text, integer) TO authenticated, service_role;

-- Sticky worker assignment for an accepted robot job --------------------------
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_worker_id text,
  ADD COLUMN IF NOT EXISTS robot_worker_url text;

CREATE INDEX IF NOT EXISTS medicaid_trips_robot_worker_idx
  ON public.medicaid_trips (robot_worker_id)
  WHERE robot_worker_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- [122/144] 20260823051809_e6a43d08-0280-4a6a-9b33-6146c67b2440.sql
-- ---------------------------------------------------------------------
-- 1. Company scoping for payroll tables ------------------------------------
ALTER TABLE public.driver_pay             ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.driver_payouts         ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.driver_hour_clearings  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

UPDATE public.driver_pay p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;
UPDATE public.driver_payouts p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;
UPDATE public.driver_hour_clearings p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_company_from_driver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.drivers WHERE id = NEW.driver_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_user_company_id();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_pay_stamp_company ON public.driver_pay;
CREATE TRIGGER driver_pay_stamp_company BEFORE INSERT ON public.driver_pay
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
DROP TRIGGER IF EXISTS driver_payouts_stamp_company ON public.driver_payouts;
CREATE TRIGGER driver_payouts_stamp_company BEFORE INSERT ON public.driver_payouts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
DROP TRIGGER IF EXISTS driver_hour_clearings_stamp_company ON public.driver_hour_clearings;
CREATE TRIGGER driver_hour_clearings_stamp_company BEFORE INSERT ON public.driver_hour_clearings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();

CREATE POLICY tenant_isolation ON public.driver_pay
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY tenant_isolation ON public.driver_payouts
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY tenant_isolation ON public.driver_hour_clearings
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());

-- 2. Payout lifecycle: void instead of destroy, keeps the audit trail --------
ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS shift_count integer NOT NULL DEFAULT 0;

-- 3. Hard link paid work to the payout that paid it -------------------------
ALTER TABLE public.driver_shifts ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
ALTER TABLE public.gas_receipts  ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_driver_shifts_payout ON public.driver_shifts(payout_id);
CREATE INDEX IF NOT EXISTS idx_gas_receipts_payout  ON public.gas_receipts(payout_id);
CREATE INDEX IF NOT EXISTS idx_driver_shifts_open   ON public.driver_shifts(driver_id, clock_in_at)
  WHERE payout_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_payouts_company_period
  ON public.driver_payouts(company_id, period_start, period_end);

-- 4. Duplicate payout prevention (identical live period for one driver) -----
CREATE UNIQUE INDEX IF NOT EXISTS driver_payouts_live_period_uniq
  ON public.driver_payouts(driver_id, period_start, period_end)
  WHERE voided_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_payouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_hour_clearings TO authenticated;
GRANT ALL ON public.driver_payouts TO service_role;
GRANT ALL ON public.driver_pay TO service_role;
GRANT ALL ON public.driver_hour_clearings TO service_role;

-- ---------------------------------------------------------------------
-- [123/144] 20260823051833_577df841-f487-4a73-9cf8-442ec82f0908.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.stamp_company_from_driver() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- [124/144] 20260823052730_5131027b-7a4c-4ac3-9336-b10a5aff53d9.sql
-- ---------------------------------------------------------------------
-- Company-level pay defaults ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_pay_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_plan text NOT NULL DEFAULT 'hourly'
    CHECK (default_plan IN ('hourly','commission','per_trip','hybrid_hourly_commission','hybrid_hourly_per_trip')),
  hourly_rate numeric CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  commission_percentage numeric CHECK (commission_percentage IS NULL OR (commission_percentage >= 0 AND commission_percentage <= 100)),
  per_trip_amount numeric CHECK (per_trip_amount IS NULL OR per_trip_amount >= 0),
  -- 'unset' blocks commission payouts until the company picks a proven base.
  commission_base text NOT NULL DEFAULT 'unset'
    CHECK (commission_base IN ('unset','paid_claims','submitted_claims','estimated_fares')),
  per_trip_source text NOT NULL DEFAULT 'completed_trips'
    CHECK (per_trip_source IN ('completed_trips')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_pay_settings TO authenticated;
GRANT ALL ON public.company_pay_settings TO service_role;
ALTER TABLE public.company_pay_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company pay settings" ON public.company_pay_settings
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE TRIGGER company_pay_settings_updated_at BEFORE UPDATE ON public.company_pay_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-driver overrides (NULL column = inherit the company default) ----------
CREATE TABLE IF NOT EXISTS public.driver_pay_plans (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  plan text CHECK (plan IS NULL OR plan IN ('hourly','commission','per_trip','hybrid_hourly_commission','hybrid_hourly_per_trip')),
  hourly_rate numeric CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  commission_percentage numeric CHECK (commission_percentage IS NULL OR (commission_percentage >= 0 AND commission_percentage <= 100)),
  per_trip_amount numeric CHECK (per_trip_amount IS NULL OR per_trip_amount >= 0),
  commission_base text CHECK (commission_base IS NULL OR commission_base IN ('paid_claims','submitted_claims','estimated_fares')),
  per_trip_source text CHECK (per_trip_source IS NULL OR per_trip_source IN ('completed_trips')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay_plans TO authenticated;
GRANT ALL ON public.driver_pay_plans TO service_role;
ALTER TABLE public.driver_pay_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company driver pay plans" ON public.driver_pay_plans
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()));
CREATE TRIGGER driver_pay_plans_stamp_company BEFORE INSERT ON public.driver_pay_plans
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER driver_pay_plans_updated_at BEFORE UPDATE ON public.driver_pay_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_driver_pay_plans_company ON public.driver_pay_plans(company_id);

-- Seed overrides from the legacy driver_pay table so nothing changes today ---
INSERT INTO public.driver_pay_plans (driver_id, company_id, plan, hourly_rate, commission_percentage, commission_base)
SELECT dp.driver_id, d.company_id,
       CASE WHEN dp.pay_type::text = 'commission' THEN 'commission' ELSE 'hourly' END,
       dp.hourly_rate, dp.payout_percentage,
       CASE WHEN dp.pay_type::text = 'commission' THEN 'paid_claims' ELSE NULL END
  FROM public.driver_pay dp JOIN public.drivers d ON d.id = dp.driver_id
ON CONFLICT (driver_id) DO NOTHING;

-- Payout snapshot: every input, rate and count that produced the total -------
ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS plan                  text,
  ADD COLUMN IF NOT EXISTS hourly_pay            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_percentage numeric,
  ADD COLUMN IF NOT EXISTS commission_base       text,
  ADD COLUMN IF NOT EXISTS revenue_base          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_amount     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_trip_amount       numeric,
  ADD COLUMN IF NOT EXISTS trip_count            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trip_pay              numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breakdown             jsonb;

-- One immutable line per piece of paid work; the unique index makes paying
-- the same shift / trip / claim twice impossible, across every pay type.
CREATE TABLE IF NOT EXISTS public.driver_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_payouts(id) ON DELETE CASCADE,
  company_id uuid,
  driver_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('shift','trip','claim','fuel')),
  ref_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_payout_items_ref_uniq ON public.driver_payout_items(kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_driver_payout_items_payout ON public.driver_payout_items(payout_id);
CREATE INDEX IF NOT EXISTS idx_driver_payout_items_driver ON public.driver_payout_items(driver_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_payout_items TO authenticated;
GRANT ALL ON public.driver_payout_items TO service_role;
ALTER TABLE public.driver_payout_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company payout items" ON public.driver_payout_items
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()));

-- Per-trip pay needs a payout link on dispatch trips too --------------------
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_trips_payout ON public.trips(payout_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver_completed ON public.trips(driver_id, scheduled_pickup_time)
  WHERE payout_id IS NULL;

-- ---------------------------------------------------------------------
-- [125/144] 20260823233743_ff4ced21-d009-4893-9f89-efe1ee43ef2b.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.driver_trip_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  rider_id uuid,
  assigned_trip_id uuid,
  label text,
  status text NOT NULL DEFAULT 'in_progress',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_trip_drafts_driver_idx ON public.driver_trip_drafts (driver_id, status, updated_at DESC);
CREATE INDEX driver_trip_drafts_company_idx ON public.driver_trip_drafts (company_id, status, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_trip_drafts TO authenticated;
GRANT ALL ON public.driver_trip_drafts TO service_role;

ALTER TABLE public.driver_trip_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers manage their own saved trips"
ON public.driver_trip_drafts FOR ALL TO authenticated
USING (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Company staff can view saved trips"
ON public.driver_trip_drafts FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND company_id = public.current_user_company_id()
  AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch())
);

CREATE OR REPLACE FUNCTION public.stamp_driver_trip_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS NULL THEN
    NEW.driver_id := auth.uid();
  END IF;
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.profiles WHERE id = NEW.driver_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER driver_trip_drafts_stamp
BEFORE INSERT OR UPDATE ON public.driver_trip_drafts
FOR EACH ROW EXECUTE FUNCTION public.stamp_driver_trip_draft();

-- ---------------------------------------------------------------------
-- [126/144] 20260823233808_c8a967c3-a258-4933-9b30-3a95e34091bc.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.stamp_driver_trip_draft() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- [127/144] 20260824152443_5ed4bb79-ee9e-4e2f-b40d-e0f2b64d95bb.sql
-- ---------------------------------------------------------------------
-- 1. Per-company communications settings -------------------------------------
CREATE TABLE public.company_comm_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'telnyx',
  sms_from_number TEXT,
  messaging_profile_id TEXT,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  inbound_webhook_path TEXT,
  notify_bill_approved BOOLEAN NOT NULL DEFAULT false,
  notify_bill_rejected BOOLEAN NOT NULL DEFAULT false,
  notify_trip_assigned BOOLEAN NOT NULL DEFAULT false,
  notify_driver_arriving BOOLEAN NOT NULL DEFAULT false,
  notify_trip_reminder BOOLEAN NOT NULL DEFAULT false,
  setup_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_comm_settings_provider_check
    CHECK (provider IN ('telnyx', 'twilio', 'none'))
);

GRANT SELECT ON public.company_comm_settings TO authenticated;
GRANT ALL ON public.company_comm_settings TO service_role;
ALTER TABLE public.company_comm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_settings_read_own_company"
  ON public.company_comm_settings FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE POLICY "comm_settings_admin_write"
  ON public.company_comm_settings FOR ALL TO authenticated
  USING (
    (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'))
    OR public.owner_unscoped()
  )
  WITH CHECK (
    (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'))
    OR public.owner_unscoped()
  );

CREATE TRIGGER trg_company_comm_settings_updated_at
  BEFORE UPDATE ON public.company_comm_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed one row per existing company, preserving any number already in use.
INSERT INTO public.company_comm_settings (company_id, provider, sms_from_number, sms_enabled)
SELECT c.id,
       CASE WHEN c.twilio_phone IS NOT NULL THEN 'twilio' ELSE 'telnyx' END,
       c.twilio_phone,
       c.twilio_phone IS NOT NULL
  FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;

-- 2. SMS conversations (dispatch inbox threads) -------------------------------
CREATE TABLE public.sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  our_number TEXT NOT NULL,
  passenger_id UUID REFERENCES public.passengers(id) ON DELETE SET NULL,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  is_known_contact BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_conversations_status_check
    CHECK (status IN ('needs_review', 'open', 'closed'))
);

CREATE UNIQUE INDEX sms_conversations_company_contact_number_key
  ON public.sms_conversations (company_id, contact_phone, our_number);
CREATE INDEX sms_conversations_company_activity_idx
  ON public.sms_conversations (company_id, last_message_at DESC);

GRANT SELECT, UPDATE ON public.sms_conversations TO authenticated;
GRANT ALL ON public.sms_conversations TO service_role;
ALTER TABLE public.sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_conversations_read_own_company"
  ON public.sms_conversations FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE POLICY "sms_conversations_staff_update"
  ON public.sms_conversations FOR UPDATE TO authenticated
  USING (
    (company_id = public.current_user_company_id()
      AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch()))
    OR public.owner_unscoped()
  )
  WITH CHECK (
    (company_id = public.current_user_company_id()
      AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch()))
    OR public.owner_unscoped()
  );

CREATE TRIGGER trg_sms_conversations_updated_at
  BEFORE UPDATE ON public.sms_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. SMS messages -------------------------------------------------------------
CREATE TABLE public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.sms_conversations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'telnyx',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  event_kind TEXT,
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT sms_messages_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received', 'skipped'))
);

CREATE UNIQUE INDEX sms_messages_provider_message_id_key
  ON public.sms_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX sms_messages_dedupe_key_key
  ON public.sms_messages (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX sms_messages_conversation_idx
  ON public.sms_messages (conversation_id, created_at);
CREATE INDEX sms_messages_company_idx
  ON public.sms_messages (company_id, created_at DESC);

GRANT SELECT ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_messages_read_own_company"
  ON public.sms_messages FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE TRIGGER trg_sms_messages_updated_at
  BEFORE UPDATE ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep the thread's activity clock fresh.
CREATE OR REPLACE FUNCTION public.bump_sms_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.sms_conversations
     SET last_message_at = NEW.created_at,
         last_inbound_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at ELSE last_inbound_at END,
         unread_count = CASE WHEN NEW.direction = 'inbound' THEN unread_count + 1 ELSE unread_count END,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sms_messages_bump_conversation
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_sms_conversation();

-- ---------------------------------------------------------------------
-- [128/144] 20260824152512_3a098c0b-49ef-4082-8a41-23576011752a.sql
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bump_sms_conversation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_sms_conversation() FROM anon;
REVOKE ALL ON FUNCTION public.bump_sms_conversation() FROM authenticated;

-- ---------------------------------------------------------------------
-- [129/144] 20260824205656_e112b5b2-3a4c-4d4d-8f2a-2868760e76c8.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.trip_destination_classifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  destination_text TEXT,
  status TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0,
  summary TEXT,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  classifier_version TEXT NOT NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX trip_destination_classifications_trip_version_key
  ON public.trip_destination_classifications (trip_id, classifier_version);
CREATE INDEX trip_destination_classifications_company_status_idx
  ON public.trip_destination_classifications (company_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_destination_classifications TO authenticated;
GRANT ALL ON public.trip_destination_classifications TO service_role;
ALTER TABLE public.trip_destination_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company classifications"
  ON public.trip_destination_classifications FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff write own company classifications"
  ON public.trip_destination_classifications FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));
CREATE POLICY "billing staff update own company classifications"
  ON public.trip_destination_classifications FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE TRIGGER trip_destination_classifications_stamp_company
  BEFORE INSERT ON public.trip_destination_classifications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER trip_destination_classifications_updated_at
  BEFORE UPDATE ON public.trip_destination_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.destination_review_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  billing_record_id UUID REFERENCES public.billing_records(id) ON DELETE CASCADE,
  classification_id UUID REFERENCES public.trip_destination_classifications(id) ON DELETE SET NULL,
  original_status TEXT NOT NULL,
  original_summary TEXT,
  note TEXT,
  overridden_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX destination_review_overrides_trip_idx ON public.destination_review_overrides (trip_id);
CREATE INDEX destination_review_overrides_company_idx ON public.destination_review_overrides (company_id, created_at DESC);

GRANT SELECT, INSERT ON public.destination_review_overrides TO authenticated;
GRANT ALL ON public.destination_review_overrides TO service_role;
ALTER TABLE public.destination_review_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company overrides"
  ON public.destination_review_overrides FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff create own company overrides"
  ON public.destination_review_overrides FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));

CREATE TRIGGER destination_review_overrides_stamp_company
  BEFORE INSERT ON public.destination_review_overrides
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

CREATE TABLE public.destination_place_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  normalized_key TEXT NOT NULL,
  address TEXT,
  place JSONB,
  nearby JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  lookup_ok BOOLEAN NOT NULL DEFAULT true,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX destination_place_cache_company_key
  ON public.destination_place_cache (company_id, normalized_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.destination_place_cache TO authenticated;
GRANT ALL ON public.destination_place_cache TO service_role;
ALTER TABLE public.destination_place_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company place cache"
  ON public.destination_place_cache FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff write own company place cache"
  ON public.destination_place_cache FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));
CREATE POLICY "billing staff update own company place cache"
  ON public.destination_place_cache FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE TRIGGER destination_place_cache_stamp_company
  BEFORE INSERT ON public.destination_place_cache
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER destination_place_cache_updated_at
  BEFORE UPDATE ON public.destination_place_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [130/144] 20260825200030_655fab95-98a1-4ca4-905b-4a89b377210e.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_pay;
DROP POLICY IF EXISTS "driver_pay admin only" ON public.driver_pay;
CREATE POLICY "Admins manage company driver pay"
ON public.driver_pay
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);

DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_payouts;
DROP POLICY IF EXISTS "Admins manage driver payouts" ON public.driver_payouts;
CREATE POLICY "Admins manage company driver payouts"
ON public.driver_payouts
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);

DROP POLICY IF EXISTS "tenant_isolation" ON public.driver_hour_clearings;
DROP POLICY IF EXISTS "Admins manage hour clearings" ON public.driver_hour_clearings;
CREATE POLICY "Admins manage company hour clearings"
ON public.driver_hour_clearings
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (owner_unscoped() OR company_id = current_user_company_id())
);

-- ---------------------------------------------------------------------
-- [131/144] 20260825200245_a5d9d1d7-f435-47ac-92e8-b9628eb352c2.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can write app settings" ON public.app_settings;
CREATE POLICY "Admins manage app settings"
ON public.app_settings
FOR ALL
TO authenticated
USING (current_user_has_role('admin'::public.app_role))
WITH CHECK (current_user_has_role('admin'::public.app_role));

DROP POLICY IF EXISTS "winners readable by authed" ON public.contest_winners;
CREATE POLICY "Admins or winning passenger can read winners"
ON public.contest_winners
FOR SELECT
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.passengers p
    WHERE p.id = contest_winners.passenger_id
      AND p.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- [132/144] 20260825200351_b477a682-1414-4e12-85c9-a77537dc31e5.sql
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage their company driver pay plans" ON public.driver_pay_plans;
CREATE POLICY "Admins manage their company driver pay plans"
ON public.driver_pay_plans
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
);

DROP POLICY IF EXISTS "Admins manage their company payout items" ON public.driver_payout_items;
CREATE POLICY "Admins manage their company payout items"
ON public.driver_payout_items
FOR ALL
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
)
WITH CHECK (
  current_user_has_role('admin'::public.app_role)
  AND (
    owner_unscoped()
    OR (company_id IS NOT NULL AND company_id = current_user_company_id())
  )
);

-- ---------------------------------------------------------------------
-- [133/144] 20260825205533_ae7faefe-0421-45b3-84c4-ba7dfe7d050d.sql
-- ---------------------------------------------------------------------
-- 1) Queue scoping + idempotency + batch + failure taxonomy
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS submit_account_key text,
  ADD COLUMN IF NOT EXISTS submit_idempotency_key text,
  ADD COLUMN IF NOT EXISTS submit_batch_id uuid,
  ADD COLUMN IF NOT EXISTS submit_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_code text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_records_submit_idem_key
  ON public.billing_records (submit_idempotency_key)
  WHERE submit_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_records_submit_account_key_idx
  ON public.billing_records (submit_account_key, status);

CREATE INDEX IF NOT EXISTS billing_records_submit_batch_idx
  ON public.billing_records (submit_batch_id);

-- 2) Batches
CREATE TABLE IF NOT EXISTS public.submission_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  total_requested integer NOT NULL DEFAULT 0,
  total_enqueued integer NOT NULL DEFAULT 0,
  total_rejected integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.submission_batches TO authenticated;
GRANT ALL ON public.submission_batches TO service_role;

ALTER TABLE public.submission_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batches_select" ON public.submission_batches;
CREATE POLICY "batches_select" ON public.submission_batches
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "batches_insert" ON public.submission_batches;
CREATE POLICY "batches_insert" ON public.submission_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_bill()
    AND company_id = public.current_user_company_id()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "batches_update" ON public.submission_batches;
CREATE POLICY "batches_update" ON public.submission_batches
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());

DROP TRIGGER IF EXISTS submission_batches_updated_at ON public.submission_batches;
CREATE TRIGGER submission_batches_updated_at
  BEFORE UPDATE ON public.submission_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS submission_batches_stamp_company ON public.submission_batches;
CREATE TRIGGER submission_batches_stamp_company
  BEFORE INSERT ON public.submission_batches
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- 3) Optional per-company worker dedication (null/empty = serves any company)
ALTER TABLE public.robot_workers
  ADD COLUMN IF NOT EXISTS company_ids uuid[];

-- 4) Lease per HCPF portal ACCOUNT, not per company row.
CREATE OR REPLACE FUNCTION public.lease_submission_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 300,
  _worker text DEFAULT NULL::text,
  _company_id uuid DEFAULT NULL::uuid,
  _stale_seconds integer DEFAULT 720,
  _record_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g  integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls integer := least(greatest(coalesce(_lease_seconds, 300), 30), 3600);
  st integer := least(greatest(coalesce(_stale_seconds, 720), 60), 7200);
  scope uuid := _company_id;
BEGIN
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH busy AS (
    -- Live portal sessions on an account ...
    SELECT coalesce(br.submit_account_key, br.company_id::text) AS akey
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on.
    SELECT coalesce(br.submit_account_key, br.company_id::text)
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT akey, count(*)::int AS n FROM busy GROUP BY akey),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_account_key, br.company_id::text) AS akey,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY coalesce(br.submit_account_key, br.company_id::text)
             ORDER BY coalesce(br.submit_next_attempt_at, br.updated_at), br.created_at
           ) AS rn
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  picked AS (
    SELECT d.id, d.trip_id, d.company_id, d.attempt, d.rn
      FROM due d
      LEFT JOIN active a ON a.akey IS NOT DISTINCT FROM d.akey
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY d.rn, d.akey, d.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_heartbeat_at = now(),
           submit_worker = _worker
      FROM picked p
     WHERE br.id = p.id
       AND br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

-- ---------------------------------------------------------------------
-- [134/144] 20260825230059_ea95bf70-ff7e-44dc-ad39-42fb9c386ea8.sql
-- ---------------------------------------------------------------------
-- =========================================================
-- Phase 1/2: payroll items + audit
-- =========================================================
CREATE TABLE public.payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'claim' CHECK (kind IN ('claim','manual','adjustment')),
  ref_id uuid,
  service_date date,
  passenger_name text,
  description text,
  category text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payroll_status text NOT NULL DEFAULT 'added' CHECK (payroll_status IN ('not_added','added','paid')),
  payout_id uuid REFERENCES public.driver_payouts(id) ON DELETE SET NULL,
  claim_number text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A claim/trip may only ever appear once per company: hard idempotency.
CREATE UNIQUE INDEX payroll_items_unique_claim
  ON public.payroll_items (company_id, ref_id)
  WHERE kind = 'claim' AND ref_id IS NOT NULL;
CREATE INDEX payroll_items_driver_idx ON public.payroll_items (company_id, driver_id, service_date DESC);
CREATE INDEX payroll_items_status_idx ON public.payroll_items (company_id, payroll_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_items TO authenticated;
GRANT ALL ON public.payroll_items TO service_role;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_items_company_read" ON public.payroll_items
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = payroll_items.driver_id AND d.user_id = auth.uid())
  );
CREATE POLICY "payroll_items_staff_write" ON public.payroll_items
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  );
CREATE POLICY "payroll_items_staff_update" ON public.payroll_items
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "payroll_items_staff_delete" ON public.payroll_items
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
         AND payroll_status <> 'paid');

CREATE TRIGGER payroll_items_stamp_company BEFORE INSERT ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER payroll_items_updated_at BEFORE UPDATE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  payroll_item_id uuid REFERENCES public.payroll_items(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  notes text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_audit_item_idx ON public.payroll_audit_log (payroll_item_id, created_at DESC);
GRANT SELECT, INSERT ON public.payroll_audit_log TO authenticated;
GRANT ALL ON public.payroll_audit_log TO service_role;
ALTER TABLE public.payroll_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_audit_read" ON public.payroll_audit_log
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id()
             AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))));
CREATE POLICY "payroll_audit_write" ON public.payroll_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id()
              AND (public.current_user_can_bill() OR public.current_user_has_role('admin')));
CREATE TRIGGER payroll_audit_stamp_company BEFORE INSERT ON public.payroll_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- =========================================================
-- Phase 4: denied claim resubmissions + service-line modifiers
-- =========================================================
CREATE TABLE public.claim_resubmissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  original_trip_id uuid NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  original_claim_number text,
  original_denial_reason text,
  original_status text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','submitted','paid','denied','cancelled')),
  resubmission_claim_number text,
  notes text,
  created_by uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Only ONE live (draft/queued) resubmission per original claim.
CREATE UNIQUE INDEX claim_resubmissions_one_live
  ON public.claim_resubmissions (original_trip_id)
  WHERE status IN ('draft','queued');
CREATE INDEX claim_resubmissions_company_idx ON public.claim_resubmissions (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_resubmissions TO authenticated;
GRANT ALL ON public.claim_resubmissions TO service_role;
ALTER TABLE public.claim_resubmissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_resubmissions_read" ON public.claim_resubmissions
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_resubmissions_write" ON public.claim_resubmissions
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE POLICY "claim_resubmissions_update" ON public.claim_resubmissions
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "claim_resubmissions_delete" ON public.claim_resubmissions
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill()
         AND status = 'draft');
CREATE TRIGGER claim_resubmissions_stamp_company BEFORE INSERT ON public.claim_resubmissions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER claim_resubmissions_updated_at BEFORE UPDATE ON public.claim_resubmissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.claim_service_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  resubmission_id uuid NOT NULL REFERENCES public.claim_resubmissions(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.medicaid_trips(id) ON DELETE SET NULL,
  line_index integer NOT NULL DEFAULT 1,
  service_date date,
  procedure_code text,
  units numeric(10,2),
  miles numeric(10,2),
  amount numeric(12,2),
  modifiers text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX claim_service_lines_unique ON public.claim_service_lines (resubmission_id, line_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_service_lines TO authenticated;
GRANT ALL ON public.claim_service_lines TO service_role;
ALTER TABLE public.claim_service_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_service_lines_read" ON public.claim_service_lines
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_service_lines_write" ON public.claim_service_lines
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE POLICY "claim_service_lines_update" ON public.claim_service_lines
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "claim_service_lines_delete" ON public.claim_service_lines
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE TRIGGER claim_service_lines_stamp_company BEFORE INSERT ON public.claim_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER claim_service_lines_updated_at BEFORE UPDATE ON public.claim_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.claim_modifier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  service_line_id uuid REFERENCES public.claim_service_lines(id) ON DELETE CASCADE,
  resubmission_id uuid REFERENCES public.claim_resubmissions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added','removed')),
  modifier text NOT NULL,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_modifier_audit_line_idx ON public.claim_modifier_audit (service_line_id, created_at DESC);
GRANT SELECT, INSERT ON public.claim_modifier_audit TO authenticated;
GRANT ALL ON public.claim_modifier_audit TO service_role;
ALTER TABLE public.claim_modifier_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_modifier_audit_read" ON public.claim_modifier_audit
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_modifier_audit_write" ON public.claim_modifier_audit
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE TRIGGER claim_modifier_audit_stamp_company BEFORE INSERT ON public.claim_modifier_audit
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- =========================================================
-- Phase 5: driver insurance / compliance documents
-- =========================================================
CREATE TABLE public.driver_insurance_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  insurer text NOT NULL,
  policy_number text NOT NULL,
  vehicle_label text,
  vehicle_plate text,
  effective_date date,
  expiration_date date NOT NULL,
  document_path text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_insurance_docs_driver_idx ON public.driver_insurance_docs (company_id, driver_id, expiration_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_insurance_docs TO authenticated;
GRANT ALL ON public.driver_insurance_docs TO service_role;
ALTER TABLE public.driver_insurance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_read" ON public.driver_insurance_docs
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_insurance_docs.driver_id AND d.user_id = auth.uid())
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch() OR public.current_user_can_bill()))
  );
CREATE POLICY "insurance_insert" ON public.driver_insurance_docs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  );
CREATE POLICY "insurance_update" ON public.driver_insurance_docs
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_insurance_docs.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  )
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "insurance_delete" ON public.driver_insurance_docs
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'));
CREATE TRIGGER driver_insurance_docs_stamp_company BEFORE INSERT ON public.driver_insurance_docs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER driver_insurance_docs_updated_at BEFORE UPDATE ON public.driver_insurance_docs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- Phase 6: vehicle expenses / maintenance receipts
-- =========================================================
CREATE TABLE public.vehicle_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_label text,
  vehicle_plate text,
  expense_date date NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('oil_change','tires','repair','inspection','maintenance','car_wash','fuel','other')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  odometer numeric(10,1),
  vendor text,
  notes text,
  receipt_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_expenses_idx ON public.vehicle_expenses (company_id, driver_id, expense_date DESC);
CREATE INDEX vehicle_expenses_category_idx ON public.vehicle_expenses (company_id, category, expense_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_expenses TO authenticated;
GRANT ALL ON public.vehicle_expenses TO service_role;
ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_expenses_read" ON public.vehicle_expenses
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch() OR public.current_user_can_bill()))
  );
CREATE POLICY "vehicle_expenses_insert" ON public.vehicle_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  );
CREATE POLICY "vehicle_expenses_update" ON public.vehicle_expenses
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin')
    )
  )
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "vehicle_expenses_delete" ON public.vehicle_expenses
  FOR DELETE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin')
    )
  );
CREATE TRIGGER vehicle_expenses_stamp_company BEFORE INSERT ON public.vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER vehicle_expenses_updated_at BEFORE UPDATE ON public.vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [135/144] 20260825230616_708627d5-ef59-43b5-8b8b-8f66a02306c5.sql
-- ---------------------------------------------------------------------
-- Files live under: driver-docs/<driver user id>/<filename>
CREATE POLICY "driver_docs_own_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "driver_docs_own_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Company staff may read their own company's driver documents.
CREATE POLICY "driver_docs_staff_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-docs'
    AND (
      public.current_user_has_role('admin')
      OR public.current_user_is_dispatch()
      OR public.current_user_can_bill()
    )
    AND EXISTS (
      SELECT 1 FROM public.drivers d
       WHERE d.user_id::text = (storage.foldername(storage.objects.name))[1]
         AND d.company_id = public.current_user_company_id()
    )
  );

-- ---------------------------------------------------------------------
-- [136/144] 20260825234058_c25ce622-24c4-4e42-979f-906761180b33.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.manual_claim_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  passenger_name text NOT NULL,
  service_date date NOT NULL,
  claim_number text,
  billed_amount numeric(12,2),
  driver_pay_amount numeric(12,2) NOT NULL DEFAULT 0,
  claim_status text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_claim_records_company_idx ON public.manual_claim_records (company_id, service_date DESC);
CREATE INDEX manual_claim_records_driver_idx ON public.manual_claim_records (company_id, driver_id, service_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_claim_records TO authenticated;
GRANT ALL ON public.manual_claim_records TO service_role;
ALTER TABLE public.manual_claim_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manual_claim_records_read" ON public.manual_claim_records
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = manual_claim_records.driver_id AND d.user_id = auth.uid())
  );
CREATE POLICY "manual_claim_records_insert" ON public.manual_claim_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  );
CREATE POLICY "manual_claim_records_update" ON public.manual_claim_records
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "manual_claim_records_delete" ON public.manual_claim_records
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')));

CREATE TRIGGER manual_claim_records_stamp_company BEFORE INSERT ON public.manual_claim_records
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER manual_claim_records_updated_at BEFORE UPDATE ON public.manual_claim_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hard duplicate protection: a manual trip can only be added to payroll once.
CREATE UNIQUE INDEX payroll_items_unique_manual_ref
  ON public.payroll_items (company_id, ref_id)
  WHERE kind = 'manual' AND ref_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- [137/144] 20260827062010_e8095e46-5244-41c6-a68a-cc2dc4a8f301.sql
-- ---------------------------------------------------------------------
-- Security-definer lookups so the restrictive policies below can resolve the
-- parent record's company without being blocked by that table's own RLS.
CREATE OR REPLACE FUNCTION public.company_of_trip(_trip_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.company_id FROM public.trips t WHERE t.id = _trip_id
$$;

CREATE OR REPLACE FUNCTION public.company_of_route(_route_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.company_id FROM public.routes r WHERE r.id = _route_id
$$;

CREATE OR REPLACE FUNCTION public.company_of_ride_request(_request_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.company_id FROM public.ride_requests r WHERE r.id = _request_id
$$;

REVOKE ALL ON FUNCTION public.company_of_trip(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_of_route(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_of_ride_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_of_trip(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_of_route(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_of_ride_request(uuid) TO authenticated, service_role;

-- Restrictive tenant isolation, matching the existing pattern used on
-- trips/routes/billing_records. service_role bypasses RLS entirely, so the
-- internal worker flows are unaffected.
DROP POLICY IF EXISTS tenant_isolation ON public.trip_stops;
CREATE POLICY tenant_isolation ON public.trip_stops
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_trip(trip_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_trip(trip_id) = current_user_company_id());

DROP POLICY IF EXISTS tenant_isolation ON public.route_stops;
CREATE POLICY tenant_isolation ON public.route_stops
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_route(route_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_route(route_id) = current_user_company_id());

DROP POLICY IF EXISTS tenant_isolation ON public.ride_passengers;
CREATE POLICY tenant_isolation ON public.ride_passengers
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  owner_unscoped()
  OR COALESCE(public.company_of_trip(trip_id), public.company_of_ride_request(request_id))
     = current_user_company_id()
)
WITH CHECK (
  owner_unscoped()
  OR COALESCE(public.company_of_trip(trip_id), public.company_of_ride_request(request_id))
     = current_user_company_id()
);

-- ---------------------------------------------------------------------
-- [138/144] 20260827062443_d189ddf2-da76-4958-bb22-7754935e4554.sql
-- ---------------------------------------------------------------------
-- 1. shifts: tenant comes from the driver.
CREATE OR REPLACE FUNCTION public.company_of_driver(_driver_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.company_id FROM public.drivers d WHERE d.id = _driver_id
$$;
REVOKE ALL ON FUNCTION public.company_of_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_of_driver(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS tenant_isolation ON public.shifts;
CREATE POLICY tenant_isolation ON public.shifts
AS RESTRICTIVE FOR ALL TO authenticated
USING (owner_unscoped() OR public.company_of_driver(driver_id) = current_user_company_id())
WITH CHECK (owner_unscoped() OR public.company_of_driver(driver_id) = current_user_company_id());

-- 2. dispatch_events: give the log its own company_id, derived from whichever
-- parent reference the event carries.
ALTER TABLE public.dispatch_events ADD COLUMN IF NOT EXISTS company_id uuid;

CREATE OR REPLACE FUNCTION public.stamp_dispatch_event_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := COALESCE(
      public.company_of_ride_request(NEW.request_id),
      public.company_of_trip(NEW.trip_id),
      public.company_of_route(NEW.route_id),
      public.company_of_driver(NEW.driver_id),
      current_user_company_id()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_dispatch_event_company_trg ON public.dispatch_events;
CREATE TRIGGER stamp_dispatch_event_company_trg
BEFORE INSERT ON public.dispatch_events
FOR EACH ROW EXECUTE FUNCTION public.stamp_dispatch_event_company();

-- Back-fill existing log rows from their parent records.
UPDATE public.dispatch_events e
SET company_id = COALESCE(r.company_id, t.company_id, ro.company_id, d.company_id)
FROM (SELECT 1) _
LEFT JOIN public.ride_requests r ON false
LEFT JOIN public.trips t ON false
LEFT JOIN public.routes ro ON false
LEFT JOIN public.drivers d ON false
WHERE false;

UPDATE public.dispatch_events e
SET company_id = COALESCE(
  (SELECT r.company_id FROM public.ride_requests r WHERE r.id = e.request_id),
  (SELECT t.company_id FROM public.trips t WHERE t.id = e.trip_id),
  (SELECT ro.company_id FROM public.routes ro WHERE ro.id = e.route_id),
  (SELECT d.company_id FROM public.drivers d WHERE d.id = e.driver_id)
)
WHERE e.company_id IS NULL;

DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_events;
CREATE POLICY tenant_isolation ON public.dispatch_events
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  owner_unscoped()
  OR company_id = current_user_company_id()
  -- Legacy rows with no parent reference carry no tenant data at all.
  OR company_id IS NULL
)
WITH CHECK (owner_unscoped() OR company_id = current_user_company_id());

-- ---------------------------------------------------------------------
-- [139/144] 20260827155729_da991e0a-5267-40cf-a63c-6452a21384c2.sql
-- ---------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON public.billing_settings
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.owner_unscoped() OR company_id = public.current_user_company_id())
WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id());

-- ---------------------------------------------------------------------
-- [140/144] 20260827204315_7a952d5a-5268-491a-b691-67206d3aca92.sql
-- ---------------------------------------------------------------------
-- 1. Verification metadata for saved portal logins (one-way; never the password)
ALTER TABLE public.state_portal_credentials
  ADD COLUMN IF NOT EXISTS password_len integer,
  ADD COLUMN IF NOT EXISTS password_fingerprint text,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- Backfill from the vault secret each row currently points at.
UPDATE public.state_portal_credentials c
   SET password_len = length(s.decrypted_secret),
       password_fingerprint = left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'), 16),
       password_updated_at = COALESCE(c.password_updated_at, s.created_at)
  FROM vault.decrypted_secrets s
 WHERE s.id = c.password_secret_id
   AND c.password_fingerprint IS NULL;

-- 2. Hardened upsert: blank password keeps the existing secret, never wipes it.
CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_id text, _portal_name text, _state text,
  _login_email text, _login_password text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
  _company UUID;
  _pw TEXT := COALESCE(_login_password, '');
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;

  _company := COALESCE(_company_id, public.current_user_company_id());
  IF _company IS DISTINCT FROM public.current_user_company_id()
     AND public.current_user_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'cannot manage another company''s credentials';
  END IF;

  SELECT id INTO _existing_id
    FROM public.state_portal_credentials
   WHERE portal_id = _portal_id
     AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_company, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Blank password on an existing row = "keep the saved password".
  IF btrim(_pw) = '' THEN
    IF _existing_id IS NULL THEN
      RAISE EXCEPTION 'password is required when saving a new portal login';
    END IF;
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name, state = _state, login_email = btrim(_login_email)
     WHERE id = _existing_id;
    RETURN _existing_id;
  END IF;

  -- Invisible edge whitespace is the classic paste bug: strip it, always.
  _pw := btrim(_pw, E' \t\r\n');
  IF _pw = '' THEN
    RAISE EXCEPTION 'password cannot be blank';
  END IF;

  _last4 := right(_pw, 4);

  _new_secret_id := vault.create_secret(
    _pw,
    'portal_' || _portal_id || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_id, portal_name, state, login_email, password_secret_id, password_last4, company_id,
       password_len, password_fingerprint, password_updated_at)
    VALUES
      (_portal_id, _portal_name, _state, btrim(_login_email), _new_secret_id, _last4, _company,
       length(_pw), left(encode(sha256(convert_to(_pw,'UTF8')),'hex'),16), now())
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET portal_name = _portal_name,
           state = _state,
           login_email = btrim(_login_email),
           password_secret_id = _new_secret_id,
           password_last4 = _last4,
           password_len = length(_pw),
           password_fingerprint = left(encode(sha256(convert_to(_pw,'UTF8')),'hex'),16),
           password_updated_at = now()
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$function$;

-- 3. Retrieval now also reports one-way verification data so callers can prove
--    the decrypted secret is exactly the one that was saved.
DROP FUNCTION IF EXISTS public.get_portal_credential_for_submission(text, uuid);
CREATE OR REPLACE FUNCTION public.get_portal_credential_for_submission(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, portal_name text, state text, login_email text, login_password text,
               password_len integer, password_fingerprint text, stored_fingerprint text,
               fingerprint_matches boolean, password_updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required: portal logins are never shared between companies';
  END IF;

  RETURN QUERY
  SELECT credential.portal_id,
         credential.portal_name,
         credential.state,
         credential.login_email,
         decrypted.decrypted_secret AS login_password,
         length(decrypted.decrypted_secret)::int AS password_len,
         left(encode(sha256(convert_to(decrypted.decrypted_secret,'UTF8')),'hex'),16) AS password_fingerprint,
         credential.password_fingerprint AS stored_fingerprint,
         (credential.password_fingerprint IS NULL
           OR credential.password_fingerprint
              = left(encode(sha256(convert_to(decrypted.decrypted_secret,'UTF8')),'hex'),16)) AS fingerprint_matches,
         credential.password_updated_at
    FROM public.state_portal_credentials AS credential
    LEFT JOIN vault.decrypted_secrets AS decrypted
      ON decrypted.id = credential.password_secret_id
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id
   LIMIT 1;

  UPDATE public.state_portal_credentials AS credential
     SET last_used_at = now()
   WHERE credential.portal_id = _portal_id
     AND credential.company_id = _company_id;
END;
$function$;

-- 4. Biller-facing diagnostic: proves what is stored without revealing it.
CREATE OR REPLACE FUNCTION public.portal_credential_fingerprint(_portal_id text, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(portal_id text, login_email text, password_len integer, password_last4 text,
               password_fingerprint text, live_fingerprint text, matches boolean,
               password_updated_at timestamptz, last_used_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  _company UUID;
BEGIN
  IF NOT public.current_user_can_bill() THEN
    RAISE EXCEPTION 'billing staff only';
  END IF;
  _company := COALESCE(_company_id, public.current_user_company_id());
  IF _company IS DISTINCT FROM public.current_user_company_id()
     AND public.current_user_company_id() IS NOT NULL THEN
    RAISE EXCEPTION 'cannot inspect another company''s credentials';
  END IF;

  RETURN QUERY
  SELECT c.portal_id,
         c.login_email,
         length(s.decrypted_secret)::int,
         c.password_last4,
         c.password_fingerprint,
         left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'),16),
         (c.password_fingerprint IS NOT NULL
           AND c.password_fingerprint = left(encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'),16)),
         c.password_updated_at,
         c.last_used_at
    FROM public.state_portal_credentials c
    LEFT JOIN vault.decrypted_secrets s ON s.id = c.password_secret_id
   WHERE c.portal_id = _portal_id AND c.company_id = _company
   LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_credential_fingerprint(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- [141/144] 20260828010324_f0542a20-40b8-458e-a171-eefeb5d063c2.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS attention_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_archived_by uuid,
  ADD COLUMN IF NOT EXISTS attention_archive_reason text,
  ADD COLUMN IF NOT EXISTS submit_wave_hold boolean NOT NULL DEFAULT false;

ALTER TABLE public.submission_batches
  ADD COLUMN IF NOT EXISTS wave_size integer NOT NULL DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_billing_records_wave_hold
  ON public.billing_records (submit_batch_id)
  WHERE submit_wave_hold;

CREATE INDEX IF NOT EXISTS idx_billing_records_attention_archived
  ON public.billing_records (attention_archived_at)
  WHERE attention_archived_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- [142/144] 20260828015544_267c9bb5-6949-4ef0-9886-eb6315ad4c1a.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.submission_batches
  ADD COLUMN IF NOT EXISTS auto_pilot boolean NOT NULL DEFAULT true;

ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS auto_pilot_default boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- [143/144] 20260828025420_8c6e438f-d25f-4c11-b5fd-78003653c0be.sql
-- ---------------------------------------------------------------------
CREATE TABLE public.auto_pilot_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_by uuid REFERENCES auth.users,
  total_requested integer NOT NULL DEFAULT 0,
  total_enqueued integer NOT NULL DEFAULT 0,
  scope_ids jsonb,
  last_feed_at timestamp with time zone,
  last_note text,
  stopped_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auto_pilot_runs_status_check CHECK (status IN ('running','stopped','finished'))
);

CREATE UNIQUE INDEX auto_pilot_runs_one_active ON public.auto_pilot_runs (company_id) WHERE status = 'running';
CREATE INDEX auto_pilot_runs_company_idx ON public.auto_pilot_runs (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.auto_pilot_runs TO authenticated;
GRANT ALL ON public.auto_pilot_runs TO service_role;

ALTER TABLE public.auto_pilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff manage own company auto pilot runs"
  ON public.auto_pilot_runs FOR ALL TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role));

CREATE POLICY "tenant_isolation" ON public.auto_pilot_runs AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.owner_unscoped() OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id());

CREATE TRIGGER auto_pilot_runs_updated_at BEFORE UPDATE ON public.auto_pilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- [144/144] 20260828050836_04b74d53-d224-4c0e-bcef-7bd7aa35e269.sql
-- ---------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS merged_into uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS drivers_merged_into_idx ON public.drivers(merged_into) WHERE merged_into IS NOT NULL;

