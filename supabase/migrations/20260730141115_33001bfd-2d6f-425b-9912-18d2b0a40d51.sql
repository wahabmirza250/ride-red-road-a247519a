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