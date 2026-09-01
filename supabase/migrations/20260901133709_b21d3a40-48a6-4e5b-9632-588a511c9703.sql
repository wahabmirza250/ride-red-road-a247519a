ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS edi_claim_id bigint,
  ADD COLUMN IF NOT EXISTS edi_batch_id bigint,
  ADD COLUMN IF NOT EXISTS edi_file_id bigint,
  ADD COLUMN IF NOT EXISTS edi_status text,
  ADD COLUMN IF NOT EXISTS edi_validation jsonb,
  ADD COLUMN IF NOT EXISTS edi_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS edi_last_error text;

CREATE INDEX IF NOT EXISTS billing_records_edi_claim_id_idx
  ON public.billing_records (edi_claim_id)
  WHERE edi_claim_id IS NOT NULL;