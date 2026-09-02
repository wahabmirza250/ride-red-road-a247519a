-- NEMT Solutions maintains one platform-wide rate schedule for every managed
-- transportation company.  A NULL company_id marks those universal rows.

drop policy if exists tenant_isolation on public.billing_rate_settings;
drop policy if exists billing_rate_settings_tenant_select on public.billing_rate_settings;
drop policy if exists billing_rate_settings_tenant_insert on public.billing_rate_settings;
drop policy if exists billing_rate_settings_tenant_update on public.billing_rate_settings;
drop policy if exists billing_rate_settings_tenant_delete on public.billing_rate_settings;

create policy billing_rate_settings_tenant_select
on public.billing_rate_settings
as restrictive
for select
to authenticated
using (
  owner_unscoped()
  or company_id is null
  or company_id = current_user_company_id()
);

create policy billing_rate_settings_tenant_insert
on public.billing_rate_settings
as restrictive
for insert
to authenticated
with check (
  owner_unscoped()
  or (company_id is not null and company_id = current_user_company_id())
);

create policy billing_rate_settings_tenant_update
on public.billing_rate_settings
as restrictive
for update
to authenticated
using (
  owner_unscoped()
  or (company_id is not null and company_id = current_user_company_id())
)
with check (
  owner_unscoped()
  or (company_id is not null and company_id = current_user_company_id())
);

create policy billing_rate_settings_tenant_delete
on public.billing_rate_settings
as restrictive
for delete
to authenticated
using (
  owner_unscoped()
  or (company_id is not null and company_id = current_user_company_id())
);

-- Seed the agreed universal ambulatory schedule. The partial unique index on
-- (vehicle_type, unit_type) WHERE company_id IS NULL prevents duplicates.
insert into public.billing_rate_settings (
  company_id, provider_id, vehicle_type, unit_type, procedure_code,
  charge_amount, place_of_service, default_diagnosis_code
)
select null, null, 'ambulatory', 'trip', 'A0120', 12.15, '41', 'R688'
where not exists (
  select 1 from public.billing_rate_settings
  where company_id is null and vehicle_type = 'ambulatory' and unit_type = 'trip'
);

insert into public.billing_rate_settings (
  company_id, provider_id, vehicle_type, unit_type, procedure_code,
  charge_amount, place_of_service, default_diagnosis_code
)
select null, null, 'ambulatory', 'mile', 'S0215', 2.74, '41', 'R688'
where not exists (
  select 1 from public.billing_rate_settings
  where company_id is null and vehicle_type = 'ambulatory' and unit_type = 'mile'
);
