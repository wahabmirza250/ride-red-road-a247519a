CREATE OR REPLACE FUNCTION public.lock_resubmission_original_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.original_trip_id IS DISTINCT FROM OLD.original_trip_id THEN
    RAISE EXCEPTION 'The original trip of a resubmission is immutable.';
  END IF;
  IF NEW.original_claim_number IS DISTINCT FROM OLD.original_claim_number THEN
    RAISE EXCEPTION 'The original claim number of a resubmission is immutable.';
  END IF;
  IF NEW.original_denial_reason IS DISTINCT FROM OLD.original_denial_reason THEN
    RAISE EXCEPTION 'The original denial reason of a resubmission is immutable.';
  END IF;
  IF NEW.original_status IS DISTINCT FROM OLD.original_status THEN
    RAISE EXCEPTION 'The original claim status of a resubmission is immutable.';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'The owning company of a resubmission is immutable.';
  END IF;

  IF NEW.original_snapshot IS DISTINCT FROM OLD.original_snapshot THEN
    -- Legacy rows carry no snapshot: allow exactly ONE null -> non-null
    -- backfill, and only while the row is still an editable draft.
    IF OLD.original_snapshot IS NULL
       AND NEW.original_snapshot IS NOT NULL
       AND OLD.status = 'draft' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'The original snapshot of a resubmission is immutable.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_resubmission_original_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS claim_resubmissions_lock_original ON public.claim_resubmissions;
CREATE TRIGGER claim_resubmissions_lock_original
  BEFORE UPDATE ON public.claim_resubmissions
  FOR EACH ROW EXECUTE FUNCTION public.lock_resubmission_original_fields();