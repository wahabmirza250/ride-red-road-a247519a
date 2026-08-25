-- 1) Queue scoping + idempotency + batch + failure taxonomy
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS submit_account_key text,
  ADD COLUMN IF NOT EXISTS submit_idempotency_key text,
  ADD COLUMN IF NOT EXISTS submit_batch_id uuid,
  ADD COLUMN IF NOT EXISTS submit_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_code text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_records_submit_idem_key
  ON public.billing_records (submit_idempotency_key)
  WHERE submit_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_records_submit_account_key_idx
  ON public.billing_records (submit_account_key, status);

CREATE INDEX IF NOT EXISTS billing_records_submit_batch_idx
  ON public.billing_records (submit_batch_id);

-- 2) Batches
CREATE TABLE IF NOT EXISTS public.submission_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  total_requested integer NOT NULL DEFAULT 0,
  total_enqueued integer NOT NULL DEFAULT 0,
  total_rejected integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.submission_batches TO authenticated;
GRANT ALL ON public.submission_batches TO service_role;

ALTER TABLE public.submission_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batches_select" ON public.submission_batches;
CREATE POLICY "batches_select" ON public.submission_batches
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (public.current_user_sees_all_bills() OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "batches_insert" ON public.submission_batches;
CREATE POLICY "batches_insert" ON public.submission_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_bill()
    AND company_id = public.current_user_company_id()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "batches_update" ON public.submission_batches;
CREATE POLICY "batches_update" ON public.submission_batches
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id());

DROP TRIGGER IF EXISTS submission_batches_updated_at ON public.submission_batches;
CREATE TRIGGER submission_batches_updated_at
  BEFORE UPDATE ON public.submission_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS submission_batches_stamp_company ON public.submission_batches;
CREATE TRIGGER submission_batches_stamp_company
  BEFORE INSERT ON public.submission_batches
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

-- 3) Optional per-company worker dedication (null/empty = serves any company)
ALTER TABLE public.robot_workers
  ADD COLUMN IF NOT EXISTS company_ids uuid[];

-- 4) Lease per HCPF portal ACCOUNT, not per company row.
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
  WITH busy AS (
    -- Live portal sessions on an account ...
    SELECT coalesce(br.submit_account_key, br.company_id::text) AS akey
      FROM public.billing_records br
      JOIN public.medicaid_trips mt ON mt.id = br.trip_id
     WHERE br.status = 'submitting'
       AND mt.robot_job_id IS NOT NULL
       AND (mt.robot_job_started_at IS NULL
            OR mt.robot_job_started_at > now() - make_interval(secs => st))
    UNION ALL
    -- ... plus rows another worker already holds a live lease on.
    SELECT coalesce(br.submit_account_key, br.company_id::text)
      FROM public.billing_records br
     WHERE br.status = 'queued'
       AND br.submit_locked_until IS NOT NULL
       AND br.submit_locked_until > now()
  ),
  active AS (SELECT akey, count(*)::int AS n FROM busy GROUP BY akey),
  total AS (SELECT coalesce(sum(n), 0)::int AS n FROM active),
  due AS (
    SELECT br.id, br.trip_id, br.company_id,
           coalesce(br.submit_account_key, br.company_id::text) AS akey,
           coalesce(br.submit_attempt_count, 0) AS attempt,
           row_number() OVER (
             PARTITION BY coalesce(br.submit_account_key, br.company_id::text)
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
      LEFT JOIN active a ON a.akey IS NOT DISTINCT FROM d.akey
     WHERE d.rn <= greatest(pc - coalesce(a.n, 0), 0)
     ORDER BY d.rn, d.akey, d.id
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
