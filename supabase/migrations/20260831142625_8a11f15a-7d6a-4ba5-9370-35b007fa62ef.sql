ALTER TABLE public.claim_resubmissions
  ADD COLUMN IF NOT EXISTS draft_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS original_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS draft_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS mileage_override_reason text,
  ADD COLUMN IF NOT EXISTS last_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_by uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_by uuid;

ALTER TABLE public.claim_service_lines
  ADD COLUMN IF NOT EXISTS place_of_service text,
  ADD COLUMN IF NOT EXISTS diagnosis_code text;

CREATE TABLE IF NOT EXISTS public.claim_resubmission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  resubmission_id uuid NOT NULL REFERENCES public.claim_resubmissions(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.claim_resubmission_events TO authenticated;
GRANT ALL ON public.claim_resubmission_events TO service_role;

ALTER TABLE public.claim_resubmission_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company staff read resubmission events" ON public.claim_resubmission_events;
CREATE POLICY "company staff read resubmission events"
  ON public.claim_resubmission_events FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR company_id = public.current_user_company_id());

DROP POLICY IF EXISTS "company staff write resubmission events" ON public.claim_resubmission_events;
CREATE POLICY "company staff write resubmission events"
  ON public.claim_resubmission_events FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (public.is_platform_owner() OR company_id = public.current_user_company_id())
  );

CREATE INDEX IF NOT EXISTS claim_resubmission_events_sub_idx
  ON public.claim_resubmission_events (resubmission_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.block_resubmission_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Resubmission audit events are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS claim_resubmission_events_immutable ON public.claim_resubmission_events;
CREATE TRIGGER claim_resubmission_events_immutable
  BEFORE UPDATE OR DELETE ON public.claim_resubmission_events
  FOR EACH ROW EXECUTE FUNCTION public.block_resubmission_event_mutation();