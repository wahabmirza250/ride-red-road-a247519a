CREATE OR REPLACE FUNCTION public.lease_submission_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 300,
  _worker text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _stale_seconds integer DEFAULT 720,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g  integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc integer := least(greatest(coalesce(_per_company_limit, 4), 1), 50);
  ls integer := least(greatest(coalesce(_lease_seconds, 300), 30), 3600);
  st integer := least(greatest(coalesce(_stale_seconds, 720), 60), 7200);
  scope uuid := _company_id;
BEGIN
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH busy AS (
    -- Live portal sessions ...
    SELECT br.company_id AS cid
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on, so two
    -- dispatchers running at the same time can never exceed the caps together.
    SELECT br.company_id
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT cid, count(*)::int AS n FROM busy GROUP BY cid),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY br.company_id
             ORDER BY coalesce(br.submit_next_attempt_at, br.updated_at), br.created_at
           ) AS rn
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  picked AS (
    SELECT d.id, d.trip_id, d.company_id, d.attempt, d.rn
      FROM due d
      LEFT JOIN active a ON a.cid IS NOT DISTINCT FROM d.company_id
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY d.rn, d.company_id, d.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_worker = _worker
      FROM picked p
     WHERE br.id = p.id
       AND br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) TO authenticated, service_role;