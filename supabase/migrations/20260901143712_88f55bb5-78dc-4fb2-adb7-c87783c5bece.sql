CREATE TABLE public.edi_company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_name text,
  npi text,
  taxonomy_code text,
  tax_id text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  phone text,
  contact_email text,
  sender_id text,
  receiver_id text,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  sftp_host text,
  sftp_port integer,
  sftp_username text,
  sftp_directory text,
  sftp_secret_configured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.edi_company_settings TO authenticated;
GRANT ALL ON public.edi_company_settings TO service_role;

ALTER TABLE public.edi_company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read own company EDI setup"
ON public.edi_company_settings FOR SELECT TO authenticated
USING (
  public.is_platform_owner()
  OR (company_id = public.current_user_company_id()
      AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
);

CREATE POLICY "Billing staff write own company EDI setup"
ON public.edi_company_settings FOR ALL TO authenticated
USING (
  public.is_platform_owner()
  OR (company_id = public.current_user_company_id()
      AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
)
WITH CHECK (
  public.is_platform_owner()
  OR (company_id = public.current_user_company_id()
      AND (public.current_user_can_bill() OR public.current_user_has_role('admin')))
);

CREATE TRIGGER edi_company_settings_updated_at
BEFORE UPDATE ON public.edi_company_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();