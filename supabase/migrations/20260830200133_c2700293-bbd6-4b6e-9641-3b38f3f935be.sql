CREATE TABLE public.paper_inbox_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'state-pdfs',
  storage_path text NOT NULL,
  file_name text NOT NULL DEFAULT 'paper-trip-report.pdf',
  mime text NOT NULL DEFAULT 'application/pdf',
  content_hash text,
  status text NOT NULL DEFAULT 'uploaded',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  ocr jsonb,
  draft jsonb,
  trip_id uuid REFERENCES public.medicaid_trips(id) ON DELETE SET NULL,
  billing_record_id uuid,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_inbox_files_status_check CHECK (status IN ('uploaded','reading','needs_review','importing','done','error'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_inbox_files TO authenticated;
GRANT ALL ON public.paper_inbox_files TO service_role;

CREATE UNIQUE INDEX paper_inbox_files_path_key
  ON public.paper_inbox_files (company_id, storage_path);
CREATE UNIQUE INDEX paper_inbox_files_hash_key
  ON public.paper_inbox_files (company_id, content_hash)
  WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX paper_inbox_files_trip_key
  ON public.paper_inbox_files (trip_id)
  WHERE trip_id IS NOT NULL;
CREATE INDEX paper_inbox_files_company_status_idx
  ON public.paper_inbox_files (company_id, status, created_at DESC);

ALTER TABLE public.paper_inbox_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read their company paper inbox"
  ON public.paper_inbox_files FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill());

CREATE POLICY "Billing staff add their company paper inbox files"
  ON public.paper_inbox_files FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());

CREATE POLICY "Billing staff update their company paper inbox files"
  ON public.paper_inbox_files FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill())
  WITH CHECK (company_id = public.current_user_company_id() AND public.current_user_can_bill());

CREATE POLICY "Billing staff delete their company paper inbox files"
  ON public.paper_inbox_files FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.current_user_can_bill());

CREATE TRIGGER paper_inbox_files_updated_at
  BEFORE UPDATE ON public.paper_inbox_files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();