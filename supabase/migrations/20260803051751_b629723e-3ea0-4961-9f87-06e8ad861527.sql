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