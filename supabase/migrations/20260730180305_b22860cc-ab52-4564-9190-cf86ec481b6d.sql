CREATE TABLE public.driver_pay (
  driver_id UUID PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  hourly_rate NUMERIC,
  pay_type public.driver_pay_type NOT NULL DEFAULT 'per_hour',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay TO authenticated;
GRANT ALL ON public.driver_pay TO service_role;

ALTER TABLE public.driver_pay ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver_pay admin only" ON public.driver_pay
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER driver_pay_set_updated_at
  BEFORE UPDATE ON public.driver_pay
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.driver_pay (driver_id, hourly_rate, pay_type)
SELECT id, NULLIF(hourly_rate, 0), pay_type FROM public.drivers
ON CONFLICT (driver_id) DO NOTHING;

ALTER TABLE public.drivers DROP COLUMN hourly_rate;
ALTER TABLE public.drivers DROP COLUMN pay_type;

DROP POLICY IF EXISTS "driver_shifts dispatch read" ON public.driver_shifts;

ALTER TABLE public.gas_receipts
  ADD COLUMN IF NOT EXISTS reimbursed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursed_by UUID;

CREATE POLICY "gas_receipts dispatch read" ON public.gas_receipts
  FOR SELECT TO authenticated
  USING (public.current_user_is_dispatch());