ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS portal_charged_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS portal_allowed_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS portal_paid_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS portal_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS billing_records_company_confirmation_uniq
  ON public.billing_records (company_id, state_confirmation_number)
  WHERE state_confirmation_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_confirmed_claim_resubmit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A bill that already holds a real portal claim number is terminal evidence:
  -- it must never re-enter the submission pipeline, and its confirmation number
  -- may never be erased or overwritten.
  IF OLD.state_confirmation_number IS NOT NULL THEN
    IF NEW.status IN ('approved', 'queued', 'submitting', 'pending_submit')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Billing record % already has portal claim number % and cannot be re-queued or resubmitted.',
        OLD.id, OLD.state_confirmation_number;
    END IF;
    IF NEW.state_confirmation_number IS DISTINCT FROM OLD.state_confirmation_number THEN
      RAISE EXCEPTION 'Portal claim number on billing record % cannot be changed or cleared.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_confirmed_claim_resubmit ON public.billing_records;
CREATE TRIGGER guard_confirmed_claim_resubmit
  BEFORE UPDATE ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_confirmed_claim_resubmit();