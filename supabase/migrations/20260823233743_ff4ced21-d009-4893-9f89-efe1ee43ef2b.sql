CREATE TABLE public.driver_trip_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  rider_id uuid,
  assigned_trip_id uuid,
  label text,
  status text NOT NULL DEFAULT 'in_progress',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_trip_drafts_driver_idx ON public.driver_trip_drafts (driver_id, status, updated_at DESC);
CREATE INDEX driver_trip_drafts_company_idx ON public.driver_trip_drafts (company_id, status, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_trip_drafts TO authenticated;
GRANT ALL ON public.driver_trip_drafts TO service_role;

ALTER TABLE public.driver_trip_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers manage their own saved trips"
ON public.driver_trip_drafts FOR ALL TO authenticated
USING (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Company staff can view saved trips"
ON public.driver_trip_drafts FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND company_id = public.current_user_company_id()
  AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch())
);

CREATE OR REPLACE FUNCTION public.stamp_driver_trip_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS NULL THEN
    NEW.driver_id := auth.uid();
  END IF;
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.profiles WHERE id = NEW.driver_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER driver_trip_drafts_stamp
BEFORE INSERT OR UPDATE ON public.driver_trip_drafts
FOR EACH ROW EXECUTE FUNCTION public.stamp_driver_trip_draft();