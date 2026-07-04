
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS portal_status TEXT DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS portal_run_id UUID,
  ADD COLUMN IF NOT EXISTS portal_confirmation TEXT,
  ADD COLUMN IF NOT EXISTS portal_evidence_prefix TEXT,
  ADD COLUMN IF NOT EXISTS portal_error TEXT,
  ADD COLUMN IF NOT EXISTS portal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_mfa_prompt TEXT;
