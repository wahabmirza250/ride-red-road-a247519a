
-- Retry pacing for the read-only sweep: a portal-side failure (checker cannot
-- reach the search form, session hiccup) must not burn the record's attempts
-- in a tight loop, and must not spin the portal. Errored rows become eligible
-- again after a cool-down, with a generous attempt ceiling.
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
  v_lease integer := greatest(30, least(coalesce(_lease_seconds, 240), 1800));
  v_inflight integer;
  v_slots integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.claim_reconcile_results r
      WHERE r.outcome = 'searching' AND r.locked_until > now())
    + (SELECT count(*) FROM public.billing_records b
      WHERE b.status_check_locked_until > now())
  INTO v_inflight;

  v_slots := greatest(0, v_global - v_inflight);
  IF v_slots = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH busy AS (
    SELECT DISTINCT r.company_id AS cid
    FROM public.claim_reconcile_results r
    WHERE r.outcome = 'searching' AND r.locked_until > now()
    UNION
    SELECT DISTINCT b.company_id AS cid
    FROM public.billing_records b
    WHERE b.status_check_locked_until > now()
  ),
  ranked AS (
    SELECT r.id AS rid,
           row_number() OVER (PARTITION BY r.company_id ORDER BY r.attempts, r.created_at) AS rn,
           r.attempts AS att, r.created_at AS crt
    FROM public.claim_reconcile_results r
    JOIN public.claim_reconcile_sweeps s ON s.id = r.sweep_id AND s.status = 'running'
    WHERE r.confirmed_at IS NULL
      AND (r.locked_until IS NULL OR r.locked_until < now())
      AND (
        (r.outcome = 'pending' AND r.attempts < 25)
        OR (r.outcome = 'error' AND r.attempts < 25 AND r.updated_at < now() - interval '10 minutes')
      )
      AND NOT EXISTS (SELECT 1 FROM busy WHERE busy.cid = r.company_id)
  ),
  picked AS (
    SELECT rid FROM ranked WHERE rn <= v_per ORDER BY att, crt LIMIT v_slots
  ),
  upd AS (
    UPDATE public.claim_reconcile_results r
    SET outcome = 'searching',
        locked_until = now() + make_interval(secs => v_lease),
        worker = _worker,
        attempts = r.attempts + 1,
        updated_at = now()
    WHERE r.id IN (SELECT rid FROM picked)
      AND r.outcome IN ('pending','error')
      AND (r.locked_until IS NULL OR r.locked_until < now())
    RETURNING r.id, r.sweep_id, r.company_id, r.billing_record_id, r.trip_id,
              r.member_id, r.service_date, r.attempts
  )
  SELECT * FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_reconcile_jobs(integer,integer,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_reconcile_jobs(integer,integer,integer,text) TO service_role;
