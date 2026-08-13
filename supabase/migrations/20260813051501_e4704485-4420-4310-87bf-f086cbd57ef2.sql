ALTER TABLE public.billing_records DROP CONSTRAINT IF EXISTS billing_records_status_check;
ALTER TABLE public.billing_records ADD CONSTRAINT billing_records_status_check CHECK (status = ANY (ARRAY['pending_review','pending_submit','submitting','submitted','approved','rejected','needs_fix','paid','suspended','denied']));

CREATE OR REPLACE FUNCTION public.protect_submitted_billing_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.state_confirmation_number IS NOT NULL THEN
    NEW.state_confirmation_number := COALESCE(NEW.state_confirmation_number, OLD.state_confirmation_number);
    -- Allow billing staff to record the real portal outcome; otherwise keep it submitted.
    IF NEW.status IS NULL OR NEW.status NOT IN ('submitted','paid','suspended','rejected','denied','approved') THEN
      NEW.status := 'submitted';
    END IF;
    NEW.submitted_at := COALESCE(OLD.submitted_at, NEW.submitted_at, now());
    NEW.submission_error := NULL;
    NEW.fix_notes := NULL;
    NEW.requires_human_step := false;
  END IF;
  RETURN NEW;
END;
$function$;