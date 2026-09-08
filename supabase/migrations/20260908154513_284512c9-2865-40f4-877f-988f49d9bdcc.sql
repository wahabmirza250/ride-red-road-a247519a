CREATE TABLE public.claim_search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_record_id uuid NOT NULL REFERENCES public.billing_records(id) ON DELETE CASCADE,
  trip_id uuid,
  company_id uuid,
  purpose text NOT NULL DEFAULT 'corrected_verify',
  member_id text,
  service_date text,
  job_id text,
  state text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  poll_attempts integer NOT NULL DEFAULT 0,
  post_attempts integer NOT NULL DEFAULT 1,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result_state text,
  match_count integer,
  claims jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.claim_search_jobs TO authenticated;
GRANT ALL ON public.claim_search_jobs TO service_role;

ALTER TABLE public.claim_search_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read their company's claim searches"
  ON public.claim_search_jobs FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id IS NOT NULL AND company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
  );

CREATE UNIQUE INDEX claim_search_jobs_one_active
  ON public.claim_search_jobs (billing_record_id, purpose)
  WHERE state = 'running';

CREATE INDEX claim_search_jobs_due ON public.claim_search_jobs (state, next_attempt_at);

CREATE TRIGGER claim_search_jobs_updated_at
  BEFORE UPDATE ON public.claim_search_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();