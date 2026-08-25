-- =========================================================
-- Phase 1/2: payroll items + audit
-- =========================================================
CREATE TABLE public.payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'claim' CHECK (kind IN ('claim','manual','adjustment')),
  ref_id uuid,
  service_date date,
  passenger_name text,
  description text,
  category text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payroll_status text NOT NULL DEFAULT 'added' CHECK (payroll_status IN ('not_added','added','paid')),
  payout_id uuid REFERENCES public.driver_payouts(id) ON DELETE SET NULL,
  claim_number text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A claim/trip may only ever appear once per company: hard idempotency.
CREATE UNIQUE INDEX payroll_items_unique_claim
  ON public.payroll_items (company_id, ref_id)
  WHERE kind = 'claim' AND ref_id IS NOT NULL;
CREATE INDEX payroll_items_driver_idx ON public.payroll_items (company_id, driver_id, service_date DESC);
CREATE INDEX payroll_items_status_idx ON public.payroll_items (company_id, payroll_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_items TO authenticated;
GRANT ALL ON public.payroll_items TO service_role;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_items_company_read" ON public.payroll_items
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = payroll_items.driver_id AND d.user_id = auth.uid())
  );
CREATE POLICY "payroll_items_staff_write" ON public.payroll_items
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  );
CREATE POLICY "payroll_items_staff_update" ON public.payroll_items
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "payroll_items_staff_delete" ON public.payroll_items
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))
         AND payroll_status <> 'paid');

CREATE TRIGGER payroll_items_stamp_company BEFORE INSERT ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER payroll_items_updated_at BEFORE UPDATE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  payroll_item_id uuid REFERENCES public.payroll_items(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  notes text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_audit_item_idx ON public.payroll_audit_log (payroll_item_id, created_at DESC);
GRANT SELECT, INSERT ON public.payroll_audit_log TO authenticated;
GRANT ALL ON public.payroll_audit_log TO service_role;
ALTER TABLE public.payroll_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_audit_read" ON public.payroll_audit_log
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id()
             AND (public.current_user_can_bill() OR public.current_user_has_role('admin'))));
CREATE POLICY "payroll_audit_write" ON public.payroll_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id()
              AND (public.current_user_can_bill() OR public.current_user_has_role('admin')));
CREATE TRIGGER payroll_audit_stamp_company BEFORE INSERT ON public.payroll_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- =========================================================
-- Phase 4: denied claim resubmissions + service-line modifiers
-- =========================================================
CREATE TABLE public.claim_resubmissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  original_trip_id uuid NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  original_claim_number text,
  original_denial_reason text,
  original_status text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','submitted','paid','denied','cancelled')),
  resubmission_claim_number text,
  notes text,
  created_by uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Only ONE live (draft/queued) resubmission per original claim.
CREATE UNIQUE INDEX claim_resubmissions_one_live
  ON public.claim_resubmissions (original_trip_id)
  WHERE status IN ('draft','queued');
CREATE INDEX claim_resubmissions_company_idx ON public.claim_resubmissions (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_resubmissions TO authenticated;
GRANT ALL ON public.claim_resubmissions TO service_role;
ALTER TABLE public.claim_resubmissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_resubmissions_read" ON public.claim_resubmissions
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_resubmissions_write" ON public.claim_resubmissions
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE POLICY "claim_resubmissions_update" ON public.claim_resubmissions
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "claim_resubmissions_delete" ON public.claim_resubmissions
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill()
         AND status = 'draft');
CREATE TRIGGER claim_resubmissions_stamp_company BEFORE INSERT ON public.claim_resubmissions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER claim_resubmissions_updated_at BEFORE UPDATE ON public.claim_resubmissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.claim_service_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  resubmission_id uuid NOT NULL REFERENCES public.claim_resubmissions(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.medicaid_trips(id) ON DELETE SET NULL,
  line_index integer NOT NULL DEFAULT 1,
  service_date date,
  procedure_code text,
  units numeric(10,2),
  miles numeric(10,2),
  amount numeric(12,2),
  modifiers text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX claim_service_lines_unique ON public.claim_service_lines (resubmission_id, line_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_service_lines TO authenticated;
GRANT ALL ON public.claim_service_lines TO service_role;
ALTER TABLE public.claim_service_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_service_lines_read" ON public.claim_service_lines
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_service_lines_write" ON public.claim_service_lines
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE POLICY "claim_service_lines_update" ON public.claim_service_lines
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "claim_service_lines_delete" ON public.claim_service_lines
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE TRIGGER claim_service_lines_stamp_company BEFORE INSERT ON public.claim_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER claim_service_lines_updated_at BEFORE UPDATE ON public.claim_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.claim_modifier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  service_line_id uuid REFERENCES public.claim_service_lines(id) ON DELETE CASCADE,
  resubmission_id uuid REFERENCES public.claim_resubmissions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added','removed')),
  modifier text NOT NULL,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_modifier_audit_line_idx ON public.claim_modifier_audit (service_line_id, created_at DESC);
GRANT SELECT, INSERT ON public.claim_modifier_audit TO authenticated;
GRANT ALL ON public.claim_modifier_audit TO service_role;
ALTER TABLE public.claim_modifier_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_modifier_audit_read" ON public.claim_modifier_audit
  FOR SELECT TO authenticated
  USING (public.owner_unscoped()
         OR (company_id = public.current_user_company_id() AND public.current_user_can_bill()));
CREATE POLICY "claim_modifier_audit_write" ON public.claim_modifier_audit
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());
CREATE TRIGGER claim_modifier_audit_stamp_company BEFORE INSERT ON public.claim_modifier_audit
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- =========================================================
-- Phase 5: driver insurance / compliance documents
-- =========================================================
CREATE TABLE public.driver_insurance_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  insurer text NOT NULL,
  policy_number text NOT NULL,
  vehicle_label text,
  vehicle_plate text,
  effective_date date,
  expiration_date date NOT NULL,
  document_path text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_insurance_docs_driver_idx ON public.driver_insurance_docs (company_id, driver_id, expiration_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_insurance_docs TO authenticated;
GRANT ALL ON public.driver_insurance_docs TO service_role;
ALTER TABLE public.driver_insurance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_read" ON public.driver_insurance_docs
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_insurance_docs.driver_id AND d.user_id = auth.uid())
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch() OR public.current_user_can_bill()))
  );
CREATE POLICY "insurance_insert" ON public.driver_insurance_docs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  );
CREATE POLICY "insurance_update" ON public.driver_insurance_docs
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_insurance_docs.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  )
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "insurance_delete" ON public.driver_insurance_docs
  FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'));
CREATE TRIGGER driver_insurance_docs_stamp_company BEFORE INSERT ON public.driver_insurance_docs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER driver_insurance_docs_updated_at BEFORE UPDATE ON public.driver_insurance_docs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- Phase 6: vehicle expenses / maintenance receipts
-- =========================================================
CREATE TABLE public.vehicle_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_label text,
  vehicle_plate text,
  expense_date date NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('oil_change','tires','repair','inspection','maintenance','car_wash','fuel','other')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  odometer numeric(10,1),
  vendor text,
  notes text,
  receipt_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_expenses_idx ON public.vehicle_expenses (company_id, driver_id, expense_date DESC);
CREATE INDEX vehicle_expenses_category_idx ON public.vehicle_expenses (company_id, category, expense_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_expenses TO authenticated;
GRANT ALL ON public.vehicle_expenses TO service_role;
ALTER TABLE public.vehicle_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_expenses_read" ON public.vehicle_expenses
  FOR SELECT TO authenticated
  USING (
    public.owner_unscoped()
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch() OR public.current_user_can_bill()))
  );
CREATE POLICY "vehicle_expenses_insert" ON public.vehicle_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin') OR public.current_user_is_dispatch()
    )
  );
CREATE POLICY "vehicle_expenses_update" ON public.vehicle_expenses
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin')
    )
  )
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY "vehicle_expenses_delete" ON public.vehicle_expenses
  FOR DELETE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_expenses.driver_id AND d.user_id = auth.uid())
      OR public.current_user_has_role('admin')
    )
  );
CREATE TRIGGER vehicle_expenses_stamp_company BEFORE INSERT ON public.vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_from_driver();
CREATE TRIGGER vehicle_expenses_updated_at BEFORE UPDATE ON public.vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();