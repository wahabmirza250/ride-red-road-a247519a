CREATE TABLE public.manual_claim_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  passenger_name text NOT NULL,
  service_date date NOT NULL,
  claim_number text,
  billed_amount numeric(12,2),
  driver_pay_amount numeric(12,2) NOT NULL DEFAULT 0,
  claim_status text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_claim_records_company_idx ON public.manual_claim_records (company_id, service_date DESC);
CREATE INDEX manual_claim_records_driver_idx ON public.manual_claim_records (company_id, driver_id, service_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_claim_records TO authenticated;
GRANT ALL ON public.manual_claim_records TO service_role;
ALTER TABLE public.manual_claim_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manual_claim_records_read" ON public.manual_claim_records
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = manual_claim_records.driver_id AND d.user_id = auth.uid())
  );
CREATE POLICY "manual_claim_records_insert" ON public.manual_claim_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  );
CREATE POLICY "manual_claim_records_update" ON public.manual_claim_records
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "manual_claim_records_delete" ON public.manual_claim_records
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')));

CREATE TRIGGER manual_claim_records_stamp_company BEFORE INSERT ON public.manual_claim_records
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER manual_claim_records_updated_at BEFORE UPDATE ON public.manual_claim_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hard duplicate protection: a manual trip can only be added to payroll once.
CREATE UNIQUE INDEX payroll_items_unique_manual_ref
  ON public.payroll_items (company_id, ref_id)
  WHERE kind = 'manual' AND ref_id IS NOT NULL;