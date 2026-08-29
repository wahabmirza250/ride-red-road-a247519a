CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit integer DEFAULT 20,
  _per_company_limit integer DEFAULT 8,
  _lease_seconds integer DEFAULT 180,
  _worker text DEFAULT NULL,
  _record_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(id uuid, trip_id uuid, company_id uuid, status text, status_check_attempts integer, claim_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
          AND (br.status_check_next_at IS NULL OR br.status_check_next_at <= now())
        )
      )
  ),
  picked AS (
    SELECT d.* FROM due d
    WHERE d.claim_number IS NOT NULL
      AND d.rn <= pc
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
      AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$fn$;