CREATE OR REPLACE FUNCTION public.lease_submission_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 4,
  _lease_seconds integer DEFAULT 300,
  _worker text DEFAULT NULL::text,
  _company_id uuid DEFAULT NULL::uuid,
  _stale_seconds integer DEFAULT 720,
  _record_ids uuid[] DEFAULT NULL::uuid[]
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
  WITH live AS (
    -- Live portal sessions on an account ...
    SELECT coalesce(br.submit_account_key, br.company_id::text) AS akey,
           coalesce('rider:' || mt.rider_id::text, 'trip:' || br.trip_id::text) AS rkey
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on.
    SELECT coalesce(br.submit_account_key, br.company_id::text),
           coalesce('rider:' || mt.rider_id::text, 'trip:' || br.trip_id::text)
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT akey, count(*)::int AS n FROM live GROUP BY akey),
  busy_riders AS (SELECT DISTINCT rkey FROM live),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_account_key, br.company_id::text) AS akey,
           coalesce('rider:' || mt.rider_id::text, 'trip:' || br.trip_id::text) AS rkey,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           coalesce(br.submit_next_attempt_at, br.updated_at) AS due_at
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'queued'
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
       AND (br.submit_next_attempt_at IS NULL OR br.submit_next_attempt_at <= now())
       AND (scope IS NULL OR br.company_id = scope)
       AND (_record_ids IS NULL OR br.id = ANY(_record_ids))
  ),
  -- RIDER FAIRNESS: only the oldest queued bill per rider is a candidate, and
  -- riders that already have a live session are skipped entirely. Other rows
  -- simply stay `queued` (no attempt burnt) and are picked up on a later tick.
  eligible AS (
    SELECT d.*,
           row_number() OVER (PARTITION BY d.rkey ORDER BY d.due_at, d.created_at_ord, d.id) AS rider_rn
      FROM (
        SELECT d2.*, br2.created_at AS created_at_ord
          FROM due d2
          JOIN public.billing_records br2 ON br2.id = d2.id
         WHERE NOT EXISTS (SELECT 1 FROM busy_riders b WHERE b.rkey = d2.rkey)
      ) d
  ),
  ranked AS (
    SELECT e.id, e.trip_id, e.company_id, e.akey, e.attempt,
           row_number() OVER (
             PARTITION BY e.akey ORDER BY e.due_at, e.created_at_ord, e.id
           ) AS rn
      FROM eligible e
     WHERE e.rider_rn = 1
  ),
  picked AS (
    SELECT r.id, r.trip_id, r.company_id, r.attempt, r.rn
      FROM ranked r
      LEFT JOIN active a ON a.akey IS NOT DISTINCT FROM r.akey
     WHERE r.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY r.rn, r.akey, r.id
     LIMIT greatest(g - (SELECT n FROM total), 0)
  ),
  locked AS (
    UPDATE public.billing_records br
       SET submit_locked_until = now() + make_interval(secs => ls),
           submit_lease_started_at = now(),
           submit_heartbeat_at = now(),
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