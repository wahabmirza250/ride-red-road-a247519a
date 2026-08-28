ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS merged_into uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS drivers_merged_into_idx ON public.drivers(merged_into) WHERE merged_into IS NOT NULL;