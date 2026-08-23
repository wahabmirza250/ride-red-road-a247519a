-- 1. Company scoping for payroll tables ------------------------------------
ALTER TABLE public.driver_pay             ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.driver_payouts         ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.driver_hour_clearings  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

UPDATE public.driver_pay p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;
UPDATE public.driver_payouts p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;
UPDATE public.driver_hour_clearings p SET company_id = d.company_id
  FROM public.drivers d WHERE d.id = p.driver_id AND p.company_id IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_company_from_driver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.drivers WHERE id = NEW.driver_id;
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_user_company_id();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_pay_stamp_company ON public.driver_pay;
CREATE TRIGGER driver_pay_stamp_company BEFORE INSERT ON public.driver_pay
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
DROP TRIGGER IF EXISTS driver_payouts_stamp_company ON public.driver_payouts;
CREATE TRIGGER driver_payouts_stamp_company BEFORE INSERT ON public.driver_payouts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
DROP TRIGGER IF EXISTS driver_hour_clearings_stamp_company ON public.driver_hour_clearings;
CREATE TRIGGER driver_hour_clearings_stamp_company BEFORE INSERT ON public.driver_hour_clearings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();

CREATE POLICY tenant_isolation ON public.driver_pay
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY tenant_isolation ON public.driver_payouts
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY tenant_isolation ON public.driver_hour_clearings
  USING (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id IS NULL OR company_id = public.current_user_company_id());

-- 2. Payout lifecycle: void instead of destroy, keeps the audit trail --------
ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS shift_count integer NOT NULL DEFAULT 0;

-- 3. Hard link paid work to the payout that paid it -------------------------
ALTER TABLE public.driver_shifts ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
ALTER TABLE public.gas_receipts  ADD COLUMN IF NOT EXISTS payout_id uuid
  REFERENCES public.driver_payouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_driver_shifts_payout ON public.driver_shifts(payout_id);
CREATE INDEX IF NOT EXISTS idx_gas_receipts_payout  ON public.gas_receipts(payout_id);
CREATE INDEX IF NOT EXISTS idx_driver_shifts_open   ON public.driver_shifts(driver_id, clock_in_at)
  WHERE payout_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_payouts_company_period
  ON public.driver_payouts(company_id, period_start, period_end);

-- 4. Duplicate payout prevention (identical live period for one driver) -----
CREATE UNIQUE INDEX IF NOT EXISTS driver_payouts_live_period_uniq
  ON public.driver_payouts(driver_id, period_start, period_end)
  WHERE voided_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_payouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_pay TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_hour_clearings TO authenticated;
GRANT ALL ON public.driver_payouts TO service_role;
GRANT ALL ON public.driver_pay TO service_role;
GRANT ALL ON public.driver_hour_clearings TO service_role;