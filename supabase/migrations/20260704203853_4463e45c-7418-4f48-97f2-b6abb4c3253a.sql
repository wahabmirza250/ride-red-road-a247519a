
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
