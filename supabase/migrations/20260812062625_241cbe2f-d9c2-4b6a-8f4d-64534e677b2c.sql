CREATE OR REPLACE FUNCTION public.protect_submitted_claims()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.submitted_confirmation, OLD.robot_confirmation_number) IS NOT NULL THEN
    NEW.submitted_confirmation := COALESCE(NEW.submitted_confirmation, OLD.submitted_confirmation);
    NEW.robot_confirmation_number := COALESCE(NEW.robot_confirmation_number, OLD.robot_confirmation_number);
    NEW.portal_confirmation := COALESCE(NEW.portal_confirmation, OLD.portal_confirmation);
    NEW.status := 'submitted';
    NEW.portal_status := 'submitted';
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    IF NEW.robot_last_status IS DISTINCT FROM 'SUBMITTED' THEN
      NEW.robot_last_status := 'SUBMITTED';
      NEW.robot_last_message := 'Claim already exists at the portal (confirmation #'
        || COALESCE(NEW.submitted_confirmation, NEW.robot_confirmation_number) || ').';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_submitted_claims ON public.medicaid_trips;
CREATE TRIGGER trg_protect_submitted_claims
BEFORE UPDATE ON public.medicaid_trips
FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_claims();

CREATE OR REPLACE FUNCTION public.protect_submitted_billing_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.state_confirmation_number IS NOT NULL THEN
    NEW.state_confirmation_number := COALESCE(NEW.state_confirmation_number, OLD.state_confirmation_number);
    NEW.status := 'submitted';
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    NEW.submission_error := NULL;
    NEW.fix_notes := NULL;
    NEW.requires_human_step := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_submitted_billing_records ON public.billing_records;
CREATE TRIGGER trg_protect_submitted_billing_records
BEFORE UPDATE ON public.billing_records
FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_billing_records();

UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended).'
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';