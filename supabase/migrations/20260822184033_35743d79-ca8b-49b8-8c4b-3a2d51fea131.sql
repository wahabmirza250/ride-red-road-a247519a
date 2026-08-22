CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit int DEFAULT 20,
  _per_company_limit int DEFAULT 4,
  _lease_seconds int DEFAULT 180,
  _worker text DEFAULT NULL,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  company_id uuid,
  status text,
  status_check_attempts integer,
  claim_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND d.rn <= greatest(_per_company_limit, 1)
    ORDER BY d.status_check_next_at NULLS FIRST
    LIMIT greatest(_global_limit, 1)
  ),
  locked AS (
    UPDATE public.billing_records br
    SET status_check_locked_until = now() + make_interval(secs => greatest(_lease_seconds, 30)),
        status_check_started_at = now(),
        status_check_worker = _worker
    FROM picked p
    WHERE br.id = p.id
      -- Re-checked under the row lock: a tick that lost the race sees the
      -- winner's lease here and simply leases nothing for this row.
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lease_claim_status_jobs(int, int, int, text, uuid[]) TO service_role;