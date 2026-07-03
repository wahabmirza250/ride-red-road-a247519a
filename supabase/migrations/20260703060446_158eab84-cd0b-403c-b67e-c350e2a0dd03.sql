ALTER TABLE public.ride_requests ALTER COLUMN passenger_id DROP NOT NULL, ALTER COLUMN pickup_lat DROP NOT NULL, ALTER COLUMN pickup_lng DROP NOT NULL, ALTER COLUMN dropoff_lat DROP NOT NULL, ALTER COLUMN dropoff_lng DROP NOT NULL, ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS contact_phone text, ADD COLUMN IF NOT EXISTS contact_medicaid text, ADD COLUMN IF NOT EXISTS requested_pickup_time timestamptz, ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

DROP POLICY IF EXISTS "Public can read active news" ON public.news_items;
CREATE POLICY "Public can read active news" ON public.news_items FOR SELECT TO anon USING (is_active = true);
GRANT SELECT ON public.news_items TO anon;

DROP POLICY IF EXISTS "Public can read active games" ON public.games;
CREATE POLICY "Public can read active games" ON public.games FOR SELECT TO anon USING (is_active = true);
GRANT SELECT ON public.games TO anon;