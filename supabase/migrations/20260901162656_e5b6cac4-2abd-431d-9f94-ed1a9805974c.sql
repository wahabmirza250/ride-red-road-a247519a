-- Super EDI: transport mode + richer status persistence
alter table public.billing_records
  add column if not exists edi_status_detail jsonb,
  add column if not exists edi_environment text;

comment on column public.billing_records.edi_status_detail is
  'Raw payload from GET /claims/{id}/status/ (999 / 277 / 835 sections). Never overwrites legacy HCPF robot fields.';
comment on column public.billing_records.edi_environment is
  'Which EDI environment (test|production) the claim/batch/file was created in.';

alter table public.edi_company_settings
  add column if not exists transport_mode text not null default 'shared',
  add column if not exists production_enabled boolean not null default false,
  add column if not exists contact_name text,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'edi_company_settings_transport_mode_check'
  ) then
    alter table public.edi_company_settings
      add constraint edi_company_settings_transport_mode_check
      check (transport_mode in ('shared', 'company'));
  end if;
end$$;

comment on column public.edi_company_settings.transport_mode is
  'shared = RedArt trading-partner connection managed centrally; company = this company has its own connection.';
comment on column public.edi_company_settings.production_enabled is
  'Set only after the company is cleared for live 837P submission; gates the PRODUCTION upload action.';

create index if not exists billing_records_edi_claim_idx
  on public.billing_records (company_id, edi_claim_id)
  where edi_claim_id is not null;
