
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS status_check_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_check_last_ms integer,
  ADD COLUMN IF NOT EXISTS status_check_worker text;

CREATE INDEX IF NOT EXISTS billing_records_status_check_lease_idx
  ON public.billing_records (company_id, status_check_next_at)
  WHERE status_check_next_at IS NOT NULL;

-- Atomic, fair, per-company bounded leasing of read-only claim-status jobs.
CREATE OR REPLACE FUNCTION public.lease_claim_status_jobs(
  _global_limit integer,
  _per_company_limit integer,
  _lease_seconds integer,
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
    SELECT br.id, br.trip_id, br.company_id, br.status,
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
    RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.status, p.attempts, p.claim_number
  FROM picked p
  JOIN locked l ON l.id = p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_claim_status_jobs(integer, integer, integer, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_claim_status_jobs(integer, integer, integer, text, uuid[]) TO service_role;

-- Queryable per-company queue metrics for observability.
CREATE OR REPLACE VIEW public.claim_status_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL
                     AND br.status_check_next_at <= now()
                     AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())) AS due_now,
  count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL
                     AND br.status_check_locked_until >= now()) AS leased_running,
  count(*) FILTER (WHERE coalesce(br.status_check_attempts, 0) > 0
                     AND br.status_check_next_at IS NOT NULL) AS retrying,
  count(*) FILTER (WHERE br.status IN ('paid','denied','rejected')) AS terminal,
  count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL) AS scheduled_total,
  avg(br.status_check_last_ms) FILTER (WHERE br.status_check_last_ms IS NOT NULL) AS avg_check_ms,
  max(br.status_checked_at) AS last_checked_at
FROM public.billing_records br
GROUP BY br.company_id;

GRANT SELECT ON public.claim_status_queue_metrics TO authenticated;
GRANT ALL ON public.claim_status_queue_metrics TO service_role;
