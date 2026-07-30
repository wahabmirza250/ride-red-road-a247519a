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