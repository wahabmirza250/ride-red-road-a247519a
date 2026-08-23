ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS submit_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS submit_lease_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS submit_worker text,
  ADD COLUMN IF NOT EXISTS submit_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submit_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS submit_last_error text,
  ADD COLUMN IF NOT EXISTS submit_last_ms integer;

CREATE INDEX IF NOT EXISTS billing_records_submit_queue_idx
  ON public.billing_records (status, submit_next_attempt_at, submit_locked_until);

CREATE TABLE IF NOT EXISTS public.submission_queue_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_by uuid,
  last_run_at timestamptz,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.submission_queue_state TO authenticated;
GRANT ALL ON public.submission_queue_state TO service_role;
ALTER TABLE public.submission_queue_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing staff read submission queue state" ON public.submission_queue_state;
CREATE POLICY "billing staff read submission queue state"
  ON public.submission_queue_state FOR SELECT TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "billing staff pause submission queue" ON public.submission_queue_state;
CREATE POLICY "billing staff pause submission queue"
  ON public.submission_queue_state FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "billing staff seed submission queue state" ON public.submission_queue_state;
CREATE POLICY "billing staff seed submission queue state"
  ON public.submission_queue_state FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'));

INSERT INTO public.submission_queue_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

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
  -- Tenant isolation: only the platform (service role) may lease across
  -- companies. Any signed-in caller is pinned to its own company.
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'service_role' THEN
    IF auth.uid() IS NOT NULL THEN
      scope := public.current_user_company_id();
    END IF;
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT br.company_id AS cid, count(*)::int AS n
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
     GROUP BY br.company_id
  ),
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
     -- Round-robin: every company gets its first slot before any company
     -- gets its second, so one tenant with 1000 bills cannot starve another.
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
       -- Re-checked under the row lock (EvalPlanQual): a dispatcher that lost
       -- the race leases nothing for this row.
       AND (br.submit_locked_until IS NULL OR br.submit_locked_until < now())
     RETURNING br.id
  )
  SELECT p.id, p.trip_id, p.company_id, p.attempt
    FROM picked p JOIN locked l ON l.id = p.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_submission_jobs(integer, integer, integer, text, uuid, integer, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_stale_submission_locks(_grace_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.billing_records
     SET submit_locked_until = NULL,
         submit_worker = NULL
   WHERE submit_locked_until IS NOT NULL
     AND submit_locked_until < now() - make_interval(secs => greatest(coalesce(_grace_seconds, 300), 60))
     AND status = 'queued';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stale_submission_locks(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_submission_locks(integer) TO authenticated, service_role;

DROP VIEW IF EXISTS public.submission_queue_metrics;
CREATE VIEW public.submission_queue_metrics
WITH (security_invoker = true) AS
SELECT
  br.company_id,
  c.name AS company_name,
  count(*) FILTER (WHERE br.status = 'queued')                                        AS queued,
  count(*) FILTER (WHERE br.status = 'queued' AND br.submit_next_attempt_at > now())  AS retrying,
  count(*) FILTER (WHERE br.status = 'submitting')                                    AS processing,
  count(*) FILTER (WHERE br.status = 'queued' AND br.submit_locked_until > now())     AS leased,
  count(*) FILTER (WHERE br.status = 'needs_fix')                                     AS needs_attention,
  count(*) FILTER (WHERE br.status = 'submitted'
                     AND br.submitted_at > now() - interval '1 hour')                 AS submitted_last_hour,
  count(*) FILTER (WHERE br.status = 'queued'
                     AND br.submit_locked_until < now() - interval '15 minutes')      AS stale_locks,
  min(br.updated_at) FILTER (WHERE br.status = 'queued')                              AS oldest_queued_at,
  avg(br.submit_last_ms) FILTER (WHERE br.submit_last_ms IS NOT NULL)                 AS avg_submit_ms,
  max(br.submitted_at)                                                                AS last_submitted_at
FROM public.billing_records br
LEFT JOIN public.companies c ON c.id = br.company_id
GROUP BY br.company_id, c.name;

GRANT SELECT ON public.submission_queue_metrics TO authenticated, service_role;