ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_check_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_check_error text;

CREATE INDEX IF NOT EXISTS billing_records_status_check_due_idx
  ON public.billing_records (status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Backfill: any already-submitted claim with a portal claim number becomes due now.
UPDATE public.billing_records
SET status_check_next_at = now()
WHERE status_check_next_at IS NULL
  AND state_confirmation_number IS NOT NULL
  AND status IN ('submitted','approved','suspended');