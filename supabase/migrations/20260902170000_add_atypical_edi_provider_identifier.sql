alter table public.edi_company_settings
  add column if not exists provider_identifier_type text not null default 'npi',
  add column if not exists medicaid_provider_id text;

alter table public.edi_company_settings
  drop constraint if exists edi_company_settings_provider_identifier_type_check;

alter table public.edi_company_settings
  add constraint edi_company_settings_provider_identifier_type_check
  check (provider_identifier_type in ('npi', 'health_first_colorado_id'));
