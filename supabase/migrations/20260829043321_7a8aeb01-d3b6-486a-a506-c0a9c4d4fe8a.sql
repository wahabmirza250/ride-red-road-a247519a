CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(_global_limit integer DEFAULT 20, _per_company_limit integer DEFAULT 8, _lease_seconds integer DEFAULT 180, _worker text DEFAULT NULL::text, _record_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, status text, status_check_attempts integer, claim_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g   integer := least(greatest(coalesce(_global_limit, 20), 1), 200);
  pc  integer := least(greatest(coalesce(_per_company_limit, 8), 1), 50);
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
           br.created_at
    FROM public.billing_records br
    JOIN public.medicaid_trips mt ON mt.id = br.trip_id
    WHERE (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
      AND (
        (_record_ids IS NOT NULL AND br.id = ANY(_record_ids))
        OR (
          _record_ids IS NULL
          AND br.status IN ('submitted', 'approved', 'suspended')
          AND (br.status_check_next_at IS NULL OR br.status_check_next_at <= now())
        )
      )
  ),
  -- Rank ONLY the rows that can actually be checked. Ranking before this
  -- filter let claim-less rows consume every per-company slot, which leased
  -- zero jobs forever.
  ranked AS (
    SELECT d.*,
           row_number() OVER (
             PARTITION BY d.company_id
             ORDER BY d.status_check_next_at NULLS FIRST, d.created_at
           ) AS rn
    FROM due d
    WHERE d.claim_number IS NOT NULL
  ),
  picked AS (
    SELECT r.* FROM ranked r
    WHERE r.rn <= pc
    ORDER BY r.rn, r.status_check_next_at NULLS FIRST
    LIMIT g
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => ls),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$function$;

UPDATE public.robot_workers
   SET enabled = true,
       max_active_jobs = 4,
       failure_streak = 0,
       unhealthy_until = NULL
 WHERE id = 'worker-2';
