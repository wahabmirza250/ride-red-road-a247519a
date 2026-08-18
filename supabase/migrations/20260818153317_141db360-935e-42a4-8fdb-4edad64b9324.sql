ALTER TABLE public.driver_pay ADD COLUMN IF NOT EXISTS payout_percentage numeric;

CREATE TABLE IF NOT EXISTS public.driver_claim_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_billed numeric NOT NULL DEFAULT 0,
  percentage_used numeric NOT NULL,
  payout_amount numeric NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_claim_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_claim_payouts(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  trip_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_claim_payout_items_trip_once UNIQUE (trip_id)
);

CREATE INDEX IF NOT EXISTS driver_claim_payouts_driver_idx ON public.driver_claim_payouts(driver_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS driver_claim_payout_items_payout_idx ON public.driver_claim_payout_items(payout_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_claim_payouts TO authenticated;
GRANT ALL ON public.driver_claim_payouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_claim_payout_items TO authenticated;
GRANT ALL ON public.driver_claim_payout_items TO service_role;

ALTER TABLE public.driver_claim_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_claim_payout_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER driver_claim_payouts_stamp_company
  BEFORE INSERT ON public.driver_claim_payouts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

CREATE TRIGGER driver_claim_payouts_set_updated_at
  BEFORE UPDATE ON public.driver_claim_payouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Billing staff manage payouts in their company"
  ON public.driver_claim_payouts FOR ALL TO authenticated
  USING (public.current_user_can_bill() AND company_id = public.current_user_company_id())
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id()));

CREATE POLICY "Drivers can view their own payouts"
  ON public.driver_claim_payouts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()));

CREATE POLICY "Billing staff manage payout items in their company"
  ON public.driver_claim_payout_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.driver_claim_payouts p
     WHERE p.id = payout_id
       AND public.current_user_can_bill()
       AND p.company_id = public.current_user_company_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.driver_claim_payouts p
     WHERE p.id = payout_id
       AND public.current_user_can_bill()
       AND p.company_id = public.current_user_company_id()));