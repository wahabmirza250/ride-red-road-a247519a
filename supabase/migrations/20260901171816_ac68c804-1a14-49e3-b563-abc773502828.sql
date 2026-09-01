-- =====================================================================
-- Super EDI: company -> EDI backend entity mapping, entity links, batches
-- =====================================================================

-- 1. One row per company: the EDI backend entities that represent it.
CREATE TABLE public.edi_company_mapping (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'test',
  edi_provider_profile_id text,
  edi_trading_partner_id text,
  edi_sftp_credentials_id text,
  trading_partner_mode text NOT NULL DEFAULT 'shared',
  provider_fingerprint text,
  trading_partner_fingerprint text,
  last_synced_at timestamp with time zone,
  last_sync_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT edi_company_mapping_environment_chk CHECK (environment IN ('test','production')),
  CONSTRAINT edi_company_mapping_mode_chk CHECK (trading_partner_mode IN ('shared','company'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.edi_company_mapping TO authenticated;
GRANT ALL ON public.edi_company_mapping TO service_role;

ALTER TABLE public.edi_company_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read own company EDI mapping"
  ON public.edi_company_mapping FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE POLICY "Billing staff write own company EDI mapping"
  ON public.edi_company_mapping FOR ALL TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  )
  WITH CHECK (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE TRIGGER edi_company_mapping_set_updated_at
  BEFORE UPDATE ON public.edi_company_mapping
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. RedArt rider / trip  ->  EDI backend patient / trip, per environment.
CREATE TABLE public.edi_entity_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  local_id uuid NOT NULL,
  edi_entity_id text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  fingerprint text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT edi_entity_links_type_chk CHECK (entity_type IN ('patient','trip')),
  CONSTRAINT edi_entity_links_environment_chk CHECK (environment IN ('test','production')),
  CONSTRAINT edi_entity_links_unique UNIQUE (company_id, entity_type, local_id, environment)
);

CREATE INDEX edi_entity_links_lookup_idx
  ON public.edi_entity_links (company_id, entity_type, edi_entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.edi_entity_links TO authenticated;
GRANT ALL ON public.edi_entity_links TO service_role;

ALTER TABLE public.edi_entity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read own company EDI entity links"
  ON public.edi_entity_links FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE POLICY "Billing staff write own company EDI entity links"
  ON public.edi_entity_links FOR ALL TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  )
  WITH CHECK (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE TRIGGER edi_entity_links_set_updated_at
  BEFORE UPDATE ON public.edi_entity_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Every submission batch a company builds, so batch/file ids are traceable.
CREATE TABLE public.edi_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  trading_partner text,
  edi_batch_id bigint,
  edi_file_id bigint,
  status text NOT NULL DEFAULT 'creating',
  record_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  claim_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT edi_batches_environment_chk CHECK (environment IN ('test','production')),
  CONSTRAINT edi_batches_number_unique UNIQUE (company_id, batch_number)
);

CREATE INDEX edi_batches_backend_idx ON public.edi_batches (company_id, edi_batch_id);
CREATE INDEX edi_batches_file_idx ON public.edi_batches (company_id, edi_file_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.edi_batches TO authenticated;
GRANT ALL ON public.edi_batches TO service_role;

ALTER TABLE public.edi_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing staff read own company EDI batches"
  ON public.edi_batches FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE POLICY "Billing staff write own company EDI batches"
  ON public.edi_batches FOR ALL TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  )
  WITH CHECK (
    public.is_platform_owner()
    OR (company_id = public.current_user_company_id()
        AND (public.current_user_can_bill() OR public.current_user_has_role('admin'::app_role)))
  );

CREATE TRIGGER edi_batches_set_updated_at
  BEFORE UPDATE ON public.edi_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. An EDI claim id may belong to exactly one bill (hence exactly one company).
CREATE UNIQUE INDEX billing_records_edi_claim_id_uniq
  ON public.billing_records (edi_claim_id)
  WHERE edi_claim_id IS NOT NULL;

CREATE INDEX billing_records_edi_batch_idx
  ON public.billing_records (company_id, edi_batch_id)
  WHERE edi_batch_id IS NOT NULL;

CREATE INDEX billing_records_edi_file_idx
  ON public.billing_records (company_id, edi_file_id)
  WHERE edi_file_id IS NOT NULL;