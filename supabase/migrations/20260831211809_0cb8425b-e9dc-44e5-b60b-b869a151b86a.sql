-- Corrected resubmissions must never reuse the original denied billing record.
-- 1) A billing record may now optionally belong to a corrected resubmission.
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS resubmission_id uuid
    REFERENCES public.claim_resubmissions(id) ON DELETE SET NULL;

-- 2) One ORIGINAL record per trip (unchanged guarantee), plus at most one
--    corrected record per resubmission (idempotency for double clicks).
ALTER TABLE public.billing_records DROP CONSTRAINT IF EXISTS billing_records_trip_id_key1;

CREATE UNIQUE INDEX IF NOT EXISTS billing_records_trip_original_uniq
  ON public.billing_records (trip_id) WHERE resubmission_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_records_resubmission_uniq
  ON public.billing_records (resubmission_id) WHERE resubmission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_records_resubmission_idx
  ON public.billing_records (resubmission_id);

-- 3) The auto-create trigger must target the ORIGINAL record only.
CREATE OR REPLACE FUNCTION public.ensure_billing_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_review') THEN
    INSERT INTO public.billing_records (trip_id, trip_form_id, status)
    VALUES (NEW.id, NEW.id, 'pending_review')
    ON CONFLICT (trip_id) WHERE resubmission_id IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) A corrected record can never be born carrying the original claim number,
--    and the original claim number of a corrected record can never be set to
--    the original claim's number by mistake.
CREATE OR REPLACE FUNCTION public.guard_corrected_billing_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  original_claim text;
BEGIN
  IF NEW.resubmission_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.original_claim_number INTO original_claim
  FROM public.claim_resubmissions r WHERE r.id = NEW.resubmission_id;
  IF original_claim IS NOT NULL
     AND nullif(btrim(coalesce(NEW.state_confirmation_number,'')),'') = original_claim THEN
    RAISE EXCEPTION 'A corrected claim can never reuse the original claim number %.', original_claim;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_corrected_billing_record ON public.billing_records;
CREATE TRIGGER trg_guard_corrected_billing_record
  BEFORE INSERT OR UPDATE ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_corrected_billing_record();