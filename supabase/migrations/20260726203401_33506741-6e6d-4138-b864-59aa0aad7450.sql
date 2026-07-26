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