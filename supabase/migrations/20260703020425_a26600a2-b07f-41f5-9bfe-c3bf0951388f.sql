
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
