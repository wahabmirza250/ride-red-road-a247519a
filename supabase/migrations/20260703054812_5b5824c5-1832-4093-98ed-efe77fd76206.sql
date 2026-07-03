
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signer_name text;
