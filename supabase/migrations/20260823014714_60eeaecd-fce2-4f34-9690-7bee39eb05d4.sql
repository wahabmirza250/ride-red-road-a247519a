-- Robot worker fleet registry -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.robot_workers (
  id text PRIMARY KEY,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_active_jobs integer NOT NULL DEFAULT 20,
  last_health_ok_at timestamptz,
  last_health_error text,
  failure_streak integer NOT NULL DEFAULT 0,
  unhealthy_until timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.robot_workers TO authenticated;
GRANT ALL ON public.robot_workers TO service_role;
ALTER TABLE public.robot_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing staff can read robot workers" ON public.robot_workers;
CREATE POLICY "billing staff can read robot workers"
ON public.robot_workers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.current_user_can_bill());

-- Health bookkeeping is written by background workers running as any billing
-- session, so it goes through a definer function instead of a write policy.
CREATE OR REPLACE FUNCTION public.record_robot_worker_health(
  _id text,
  _base_url text,
  _ok boolean,
  _error text DEFAULT NULL,
  _cooldown_seconds integer DEFAULT 120
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.robot_workers (id, base_url)
  VALUES (_id, _base_url)
  ON CONFLICT (id) DO NOTHING;

  IF _ok THEN
    UPDATE public.robot_workers
       SET last_health_ok_at = now(),
           last_health_error = NULL,
           failure_streak = 0,
           unhealthy_until = NULL,
           updated_at = now()
     WHERE id = _id;
  ELSE
    UPDATE public.robot_workers
       SET failure_streak = failure_streak + 1,
           last_health_error = left(coalesce(_error, 'unknown error'), 500),
           unhealthy_until = now() + make_interval(secs => greatest(30, least(3600, _cooldown_seconds))),
           updated_at = now()
     WHERE id = _id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_robot_worker_health(text, text, boolean, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.record_robot_worker_health(text, text, boolean, text, integer) TO authenticated, service_role;

-- Sticky worker assignment for an accepted robot job --------------------------
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_worker_id text,
  ADD COLUMN IF NOT EXISTS robot_worker_url text;

CREATE INDEX IF NOT EXISTS medicaid_trips_robot_worker_idx
  ON public.medicaid_trips (robot_worker_id)
  WHERE robot_worker_id IS NOT NULL;