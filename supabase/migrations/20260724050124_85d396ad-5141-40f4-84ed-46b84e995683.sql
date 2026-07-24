CREATE TABLE IF NOT EXISTS public.dispatch_trip_report_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_trip_report_drafts_dispatch_trip_id_key UNIQUE (dispatch_trip_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_trip_report_drafts TO authenticated;
GRANT ALL ON public.dispatch_trip_report_drafts TO service_role;

ALTER TABLE public.dispatch_trip_report_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assigned drivers and admins can read drafts"
  ON public.dispatch_trip_report_drafts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Assigned drivers and admins can create drafts"
  ON public.dispatch_trip_report_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Assigned drivers and admins can update drafts"
  ON public.dispatch_trip_report_drafts
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = dispatch_trip_report_drafts.dispatch_trip_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can delete drafts"
  ON public.dispatch_trip_report_drafts
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_dispatch_trip_report_drafts_updated_at ON public.dispatch_trip_report_drafts;
CREATE TRIGGER trg_dispatch_trip_report_drafts_updated_at
  BEFORE UPDATE ON public.dispatch_trip_report_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();