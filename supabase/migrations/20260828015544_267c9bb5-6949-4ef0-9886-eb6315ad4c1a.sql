ALTER TABLE public.submission_batches
  ADD COLUMN IF NOT EXISTS auto_pilot boolean NOT NULL DEFAULT true;

ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS auto_pilot_default boolean NOT NULL DEFAULT true;