-- 1) Fair, clamped, atomic leasing ------------------------------------------
CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 180,
  _worker text DEFAULT NULL::text,
  _record_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, status text, status_check_attempts integer, claim_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g   integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc  integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls  integer := least(greatest(coalesce(_lease_seconds, 180), 30), 3600);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT br.id, br.trip_id, br.company_id, br.status::text AS status,
           coalesce(br.status_check_attempts, 0) AS attempts,
           nullif(btrim(coalesce(br.state_confirmation_number,
                                 mt.robot_confirmation_number,
                                 mt.submitted_confirmation, '')), '') AS claim_number,
           br.status_check_next_at,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY br.status_check_next_at NULLS FIRST, br.created_at
           ) AS rn
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND br.status_check_next_at IS NOT NULL
          AND br.status_check_next_at <= now()
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= pc
    -- Round-robin across companies FIRST: every company gets its 1st slot
    -- before any company gets its 2nd. A company with hundreds of due
    -- claims can never consume the whole global batch.
    ORDER BY d.rn, d.status_check_next_at NULLS FIRST
    LIMIT g
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => ls),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      -- Re-checked under the row lock (EvalPlanQual): a tick that lost the
      -- race sees the winner's lease here and leases nothing for this row.
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$function$;

-- 2) Operations / metrics surface -------------------------------------------
DROP VIEW IF EXISTS public.claim_status_queue_metrics;
CREATE VIEW public.claim_status_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  c.name AS company_name,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now()
                     AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())) AS due_now,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL AND br.status_check_locked_until >= now()) AS leased_running,
  count(*) FILTER (WHERE coalesce(br.status_check_attempts, 0) > 0 AND br.status_check_next_at IS NOT NULL) AS retrying,
  count(*) FILTER (WHERE br.status_check_error IS NOT NULL) AS errored,
  count(*) FILTER (WHERE br.status = ANY (ARRAY['paid','denied','rejected'])) AS terminal,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL) AS scheduled_total,
  count(*) FILTER (WHERE br.status_checked_at IS NOT NULL AND br.status_checked_at >= now() - interval '1 hour') AS checked_last_hour,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL
                     AND br.status_check_locked_until < now() - interval '30 minutes') AS stale_locks,
  avg(br.status_check_last_ms) FILTER (WHERE br.status_check_last_ms IS NOT NULL) AS avg_check_ms,
  min(br.status_check_next_at) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now()) AS oldest_due_at,
  max(br.status_checked_at) AS last_checked_at
FROM public.billing_records br
LEFT JOIN public.companies c ON c.id = br.company_id
GROUP BY br.company_id, c.name;

GRANT SELECT ON public.claim_status_queue_metrics TO authenticated;
GRANT SELECT ON public.claim_status_queue_metrics TO service_role;

-- 3) Self-healing sweep: release leases abandoned by a crashed worker -------
CREATE OR REPLACE FUNCTION public.release_stale_claim_status_locks(_grace_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.billing_records
  SET status_check_locked_until = NULL,
      status_check_worker = NULL
  WHERE status_check_locked_until IS NOT NULL
    AND status_check_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stale_claim_status_locks(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_claim_status_locks(integer) TO service_role;