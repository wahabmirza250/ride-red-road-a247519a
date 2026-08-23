-- Company-level pay defaults ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_pay_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_plan text NOT NULL DEFAULT 'hourly'
    CHECK (default_plan IN ('hourly','commission','per_trip','hybrid_hourly_commission','hybrid_hourly_per_trip')),
  hourly_rate numeric CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  commission_percentage numeric CHECK (commission_percentage IS NULL OR (commission_percentage >= 0 AND commission_percentage <= 100)),
  per_trip_amount numeric CHECK (per_trip_amount IS NULL OR per_trip_amount >= 0),
  -- 'unset' blocks commission payouts until the company picks a proven base.
  commission_base text NOT NULL DEFAULT 'unset'
    CHECK (commission_base IN ('unset','paid_claims','submitted_claims','estimated_fares')),
  per_trip_source text NOT NULL DEFAULT 'completed_trips'
    CHECK (per_trip_source IN ('completed_trips')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_pay_settings TO authenticated;
GRANT ALL ON public.company_pay_settings TO service_role;
ALTER TABLE public.company_pay_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company pay settings" ON public.company_pay_settings
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE TRIGGER company_pay_settings_updated_at BEFORE UPDATE ON public.company_pay_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-driver overrides (NULL column = inherit the company default) ----------
CREATE TABLE IF NOT EXISTS public.driver_pay_plans (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  plan text CHECK (plan IS NULL OR plan IN ('hourly','commission','per_trip','hybrid_hourly_commission','hybrid_hourly_per_trip')),
  hourly_rate numeric CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  commission_percentage numeric CHECK (commission_percentage IS NULL OR (commission_percentage >= 0 AND commission_percentage <= 100)),
  per_trip_amount numeric CHECK (per_trip_amount IS NULL OR per_trip_amount >= 0),
  commission_base text CHECK (commission_base IS NULL OR commission_base IN ('paid_claims','submitted_claims','estimated_fares')),
  per_trip_source text CHECK (per_trip_source IS NULL OR per_trip_source IN ('completed_trips')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay_plans TO authenticated;
GRANT ALL ON public.driver_pay_plans TO service_role;
ALTER TABLE public.driver_pay_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company driver pay plans" ON public.driver_pay_plans
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()));
CREATE TRIGGER driver_pay_plans_stamp_company BEFORE INSERT ON public.driver_pay_plans
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER driver_pay_plans_updated_at BEFORE UPDATE ON public.driver_pay_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_driver_pay_plans_company ON public.driver_pay_plans(company_id);

-- Seed overrides from the legacy driver_pay table so nothing changes today ---
INSERT INTO public.driver_pay_plans (driver_id, company_id, plan, hourly_rate, commission_percentage, commission_base)
SELECT dp.driver_id, d.company_id,
       CASE WHEN dp.pay_type::text = 'commission' THEN 'commission' ELSE 'hourly' END,
       dp.hourly_rate, dp.payout_percentage,
       CASE WHEN dp.pay_type::text = 'commission' THEN 'paid_claims' ELSE NULL END
  FROM public.driver_pay dp JOIN public.drivers d ON d.id = dp.driver_id
ON CONFLICT (driver_id) DO NOTHING;

-- Payout snapshot: every input, rate and count that produced the total -------
ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS plan                  text,
  ADD COLUMN IF NOT EXISTS hourly_pay            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_percentage numeric,
  ADD COLUMN IF NOT EXISTS commission_base       text,
  ADD COLUMN IF NOT EXISTS revenue_base          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_amount     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_trip_amount       numeric,
  ADD COLUMN IF NOT EXISTS trip_count            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trip_pay              numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breakdown             jsonb;

-- One immutable line per piece of paid work; the unique index makes paying
-- the same shift / trip / claim twice impossible, across every pay type.
CREATE TABLE IF NOT EXISTS public.driver_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_payouts(id) ON DELETE CASCADE,
  company_id uuid,
  driver_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('shift','trip','claim','fuel')),
  ref_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_payout_items_ref_uniq ON public.driver_payout_items(kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_driver_payout_items_payout ON public.driver_payout_items(payout_id);
CREATE INDEX IF NOT EXISTS idx_driver_payout_items_driver ON public.driver_payout_items(driver_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_payout_items TO authenticated;
GRANT ALL ON public.driver_payout_items TO service_role;
ALTER TABLE public.driver_payout_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage their company payout items" ON public.driver_payout_items
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_has_role('admin') AND (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id()));

-- Per-trip pay needs a payout link on dispatch trips too --------------------
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_trips_payout ON public.trips(payout_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver_completed ON public.trips(driver_id, scheduled_pickup_time)
  WHERE payout_id IS NULL;