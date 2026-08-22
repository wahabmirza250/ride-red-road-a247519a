
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS billing_records_status_check_lock_idx
  ON public.billing_records (status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Recover any lease left behind by a run that was cut off mid-flight.
UPDATE public.claim_status_sync_state
  SET lease_until = NULL, updated_at = now()
  WHERE id = true;
