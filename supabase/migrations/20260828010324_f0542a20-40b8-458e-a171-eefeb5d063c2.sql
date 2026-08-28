ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS attention_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_archived_by uuid,
  ADD COLUMN IF NOT EXISTS attention_archive_reason text,
  ADD COLUMN IF NOT EXISTS submit_wave_hold boolean NOT NULL DEFAULT false;

ALTER TABLE public.submission_batches
  ADD COLUMN IF NOT EXISTS wave_size integer NOT NULL DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_billing_records_wave_hold
  ON public.billing_records (submit_batch_id)
  WHERE submit_wave_hold;

CREATE INDEX IF NOT EXISTS idx_billing_records_attention_archived
  ON public.billing_records (attention_archived_at)
  WHERE attention_archived_at IS NOT NULL;