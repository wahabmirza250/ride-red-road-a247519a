
CREATE TABLE public.claim_reconcile_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  total integer NOT NULL DEFAULT 0,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT claim_reconcile_sweeps_status_chk CHECK (status IN ('running','paused','done'))
);

CREATE TABLE public.claim_reconcile_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id uuid NOT NULL REFERENCES public.claim_reconcile_sweeps(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  billing_record_id uuid NOT NULL REFERENCES public.billing_records(id) ON DELETE CASCADE,
  trip_id uuid,
  member_id text,
  service_date text,
  outcome text NOT NULL DEFAULT 'pending',
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_count integer,
  result_state text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  worker text,
  searched_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirm_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_reconcile_results_outcome_chk
    CHECK (outcome IN ('pending','searching','single','none','multiple','error')),
  CONSTRAINT claim_reconcile_results_uniq UNIQUE (sweep_id, billing_record_id)
);

CREATE INDEX claim_reconcile_results_lease_idx
  ON public.claim_reconcile_results (company_id, outcome, locked_until);
CREATE INDEX claim_reconcile_results_record_idx
  ON public.claim_reconcile_results (billing_record_id);

GRANT SELECT, INSERT, UPDATE ON public.claim_reconcile_sweeps TO authenticated;
GRANT ALL ON public.claim_reconcile_sweeps TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.claim_reconcile_results TO authenticated;
GRANT ALL ON public.claim_reconcile_results TO service_role;

ALTER TABLE public.claim_reconcile_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_reconcile_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read sweeps in their company"
  ON public.claim_reconcile_sweeps FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "Billing staff start sweeps in their company"
  ON public.claim_reconcile_sweeps FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND company_id = public.current_user_company_id());
CREATE POLICY "Billing staff update sweeps in their company"
  ON public.claim_reconcile_sweeps FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE POLICY "Billing staff read sweep results in their company"
  ON public.claim_reconcile_results FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "Billing staff update sweep results in their company"
  ON public.claim_reconcile_results FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE TRIGGER claim_reconcile_sweeps_touch BEFORE UPDATE ON public.claim_reconcile_sweeps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER claim_reconcile_results_touch BEFORE UPDATE ON public.claim_reconcile_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic lease: at most one active read-only portal session per company, and a
-- global ceiling shared with the paid-amount status audit. A company that is
-- already running a status check is skipped entirely for this tick.
CREATE OR REPLACE FUNCTION public.lease_reconcile_jobs(
  _global_limit integer,
  _per_company_limit integer,
  _lease_seconds integer,
  _worker text
)
RETURNS TABLE(
  id uuid, sweep_id uuid, company_id uuid, billing_record_id uuid,
  trip_id uuid, member_id text, service_date text, attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global integer := greatest(1, least(coalesce(_global_limit, 1), 3));
  v_per integer := greatest(1, least(coalesce(_per_company_limit, 1), 1));
  v_lease integer := greatest(30, least(coalesce(_lease_seconds, 300), 1800));
BEGIN
  RETURN QUERY
  WITH busy AS (
    SELECT DISTINCT r.company_id
    FROM public.claim_reconcile_results r
    WHERE r.outcome = 'searching' AND r.locked_until > now()
    UNION
    SELECT DISTINCT b.company_id
    FROM public.billing_records b
    WHERE b.status_check_locked_until > now()
  ),
  inflight AS (
    SELECT count(*)::int AS n FROM public.claim_reconcile_results r
    WHERE r.outcome = 'searching' AND r.locked_until > now()
  ),
  status_inflight AS (
    SELECT count(*)::int AS n FROM public.billing_records b
    WHERE b.status_check_locked_until > now()
  ),
  picked AS (
    SELECT r.id
    FROM public.claim_reconcile_results r
    JOIN public.claim_reconcile_sweeps s ON s.id = r.sweep_id AND s.status = 'running'
    WHERE r.outcome IN ('pending','error')
      AND r.confirmed_at IS NULL
      AND (r.locked_until IS NULL OR r.locked_until < now())
      AND r.attempts < 5
      AND r.company_id NOT IN (SELECT company_id FROM busy WHERE company_id IS NOT NULL)
    ORDER BY r.attempts ASC, r.created_at ASC
    LIMIT greatest(0, v_global - (SELECT n FROM inflight) - (SELECT n FROM status_inflight))
    FOR UPDATE SKIP LOCKED
  ),
  fair AS (
    SELECT p.id FROM picked p
    JOIN public.claim_reconcile_results r ON r.id = p.id
    WHERE (
      SELECT count(*) FROM picked p2
      JOIN public.claim_reconcile_results r2 ON r2.id = p2.id
      WHERE r2.company_id = r.company_id AND r2.created_at < r.created_at
    ) < v_per
  ),
  upd AS (
    UPDATE public.claim_reconcile_results r
    SET outcome = 'searching',
        locked_until = now() + make_interval(secs => v_lease),
        worker = _worker,
        attempts = r.attempts + 1,
        updated_at = now()
    WHERE r.id IN (SELECT id FROM fair)
    RETURNING r.id, r.sweep_id, r.company_id, r.billing_record_id, r.trip_id,
              r.member_id, r.service_date, r.attempts
  )
  SELECT * FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_reconcile_jobs(integer,integer,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_reconcile_jobs(integer,integer,integer,text) TO service_role;

-- Abandoned leases (worker crash / request timeout) become eligible again.
CREATE OR REPLACE FUNCTION public.release_stale_reconcile_locks(_grace_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.claim_reconcile_results
  SET outcome = 'pending', locked_until = NULL, updated_at = now()
  WHERE outcome = 'searching'
    AND locked_until < now() - make_interval(secs => greatest(30, coalesce(_grace_seconds, 120)));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_reconcile_locks(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_reconcile_locks(integer) TO service_role;
