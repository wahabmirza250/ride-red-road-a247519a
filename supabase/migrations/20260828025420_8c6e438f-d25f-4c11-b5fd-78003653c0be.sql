CREATE TABLE public.auto_pilot_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_by uuid REFERENCES auth.users,
  total_requested integer NOT NULL DEFAULT 0,
  total_enqueued integer NOT NULL DEFAULT 0,
  scope_ids jsonb,
  last_feed_at timestamp with time zone,
  last_note text,
  stopped_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auto_pilot_runs_status_check CHECK (status IN ('running','stopped','finished'))
);

CREATE UNIQUE INDEX auto_pilot_runs_one_active ON public.auto_pilot_runs (company_id) WHERE status = 'running';
CREATE INDEX auto_pilot_runs_company_idx ON public.auto_pilot_runs (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.auto_pilot_runs TO authenticated;
GRANT ALL ON public.auto_pilot_runs TO service_role;

ALTER TABLE public.auto_pilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff manage own company auto pilot runs"
  ON public.auto_pilot_runs FOR ALL TO authenticated
  USING (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role));

CREATE POLICY "tenant_isolation" ON public.auto_pilot_runs AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.owner_unscoped() OR company_id = public.current_user_company_id())
  WITH CHECK (public.owner_unscoped() OR company_id = public.current_user_company_id());

CREATE TRIGGER auto_pilot_runs_updated_at BEFORE UPDATE ON public.auto_pilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();