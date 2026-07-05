
-- Rename the legacy billing table so we can reuse the name for the Medicaid pipeline
ALTER TABLE public.billing_records RENAME TO trip_billing_records;
ALTER INDEX IF EXISTS billing_records_pkey RENAME TO trip_billing_records_pkey;

-- ==========================================================
-- BILLING RECORDS (Medicaid pipeline)
-- ==========================================================
CREATE TABLE public.billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  trip_form_id UUID,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_submit','submitting','submitted','approved','rejected','needs_fix')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  fix_notes TEXT,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  state_confirmation_number TEXT,
  submission_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX billing_records_status_idx ON public.billing_records (status, updated_at DESC);
CREATE INDEX billing_records_trip_idx ON public.billing_records (trip_id);

GRANT SELECT, INSERT, UPDATE ON public.billing_records TO authenticated;
GRANT ALL ON public.billing_records TO service_role;

ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_records admin all"
  ON public.billing_records FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "billing_records driver read own"
  ON public.billing_records FOR SELECT TO authenticated
  USING (
    trip_id IN (SELECT id FROM public.medicaid_trips WHERE driver_id = auth.uid())
  );

CREATE TRIGGER trg_billing_records_updated_at
  BEFORE UPDATE ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_billing_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_review') THEN
    INSERT INTO public.billing_records (trip_id, trip_form_id, status)
    VALUES (NEW.id, NEW.id, 'pending_review')
    ON CONFLICT (trip_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ensure_billing_record
  AFTER INSERT OR UPDATE OF status ON public.medicaid_trips
  FOR EACH ROW EXECUTE FUNCTION public.ensure_billing_record();

-- Backfill existing medicaid trips
INSERT INTO public.billing_records (trip_id, trip_form_id, status, submitted_at, state_confirmation_number)
SELECT id, id,
  CASE status::text
    WHEN 'pending_review' THEN 'pending_review'
    WHEN 'approved'       THEN 'pending_submit'
    WHEN 'submitted'      THEN 'submitted'
    WHEN 'rejected'       THEN 'rejected'
    WHEN 'needs_fix'      THEN 'needs_fix'
    ELSE 'pending_review'
  END,
  submitted_at,
  submitted_confirmation
FROM public.medicaid_trips
ON CONFLICT (trip_id) DO NOTHING;

-- ==========================================================
-- BILLING AUDIT LOG
-- ==========================================================
CREATE TABLE public.billing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_record_id UUID NOT NULL REFERENCES public.billing_records(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'admin' CHECK (actor_type IN ('admin','driver','system')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX billing_audit_log_record_idx ON public.billing_audit_log (billing_record_id, created_at DESC);

GRANT SELECT, INSERT ON public.billing_audit_log TO authenticated;
GRANT ALL ON public.billing_audit_log TO service_role;

ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_audit_log admin all"
  ON public.billing_audit_log FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

-- ==========================================================
-- STATE PORTAL CREDENTIALS (password via Supabase Vault)
-- ==========================================================
CREATE TABLE public.state_portal_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_name TEXT NOT NULL,
  state TEXT NOT NULL,
  login_email TEXT NOT NULL,
  password_secret_id UUID,
  password_last4 TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_name, state)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_portal_credentials TO authenticated;
GRANT ALL ON public.state_portal_credentials TO service_role;

ALTER TABLE public.state_portal_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_credentials admin all"
  ON public.state_portal_credentials FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE TRIGGER trg_portal_credentials_updated_at
  BEFORE UPDATE ON public.state_portal_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.upsert_portal_credential(
  _portal_name TEXT,
  _state TEXT,
  _login_email TEXT,
  _login_password TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing_id UUID;
  _new_secret_id UUID;
  _last4 TEXT;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id INTO _existing_id FROM public.state_portal_credentials
   WHERE portal_name = _portal_name AND state = _state;

  _last4 := right(_login_password, 4);

  _new_secret_id := vault.create_secret(
    _login_password,
    'portal_' || _portal_name || '_' || _state || '_' || replace(gen_random_uuid()::text,'-',''),
    'State portal password'
  );

  IF _existing_id IS NULL THEN
    INSERT INTO public.state_portal_credentials
      (portal_name, state, login_email, password_secret_id, password_last4)
    VALUES (_portal_name, _state, _login_email, _new_secret_id, _last4)
    RETURNING id INTO _existing_id;
  ELSE
    UPDATE public.state_portal_credentials
       SET login_email = _login_email,
           password_secret_id = _new_secret_id,
           password_last4 = _last4
     WHERE id = _existing_id;
  END IF;

  RETURN _existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_portal_credential(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_portal_credential(TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ==========================================================
-- REALTIME
-- ==========================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_records') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_records';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_audit_log') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_audit_log';
  END IF;
END $$;
