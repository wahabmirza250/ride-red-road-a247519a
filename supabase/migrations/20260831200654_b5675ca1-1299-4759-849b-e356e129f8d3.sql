ALTER TABLE public.claim_resubmissions DROP CONSTRAINT IF EXISTS claim_resubmissions_status_check;
ALTER TABLE public.claim_resubmissions
  ADD CONSTRAINT claim_resubmissions_status_check
  CHECK (status = ANY (ARRAY['draft'::text,'queued'::text,'processing'::text,'submitted'::text,'paid'::text,'denied'::text,'failed'::text,'cancelled'::text]));

DROP INDEX IF EXISTS public.claim_resubmissions_one_live;
CREATE UNIQUE INDEX claim_resubmissions_one_live
  ON public.claim_resubmissions (original_trip_id)
  WHERE status = ANY (ARRAY['draft'::text,'queued'::text,'processing'::text]);

ALTER TABLE public.claim_resubmissions
  ADD COLUMN IF NOT EXISTS submission_billing_record_id uuid REFERENCES public.billing_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE INDEX IF NOT EXISTS claim_resubmissions_active_record_idx
  ON public.claim_resubmissions (submission_billing_record_id)
  WHERE status = ANY (ARRAY['processing'::text,'submitted'::text]);