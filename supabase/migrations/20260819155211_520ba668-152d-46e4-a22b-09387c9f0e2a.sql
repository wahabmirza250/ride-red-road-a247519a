ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_status_raw text;

CREATE TABLE IF NOT EXISTS public.claim_status_sync_state (
  id boolean PRIMARY KEY DEFAULT true,
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.claim_status_sync_state TO authenticated;
GRANT ALL ON public.claim_status_sync_state TO service_role;

ALTER TABLE public.claim_status_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_status_sync_state readable by billing staff" ON public.claim_status_sync_state;
CREATE POLICY "claim_status_sync_state readable by billing staff"
  ON public.claim_status_sync_state FOR SELECT TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'));

INSERT INTO public.claim_status_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS billing_records_status_check_idx
  ON public.billing_records (status_checked_at NULLS FIRST)
  WHERE state_confirmation_number IS NOT NULL;