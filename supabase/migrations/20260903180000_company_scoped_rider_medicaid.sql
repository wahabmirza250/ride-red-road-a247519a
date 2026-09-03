-- Medicaid IDs belong to a company, not globally to every tenant.
-- Historical same-company duplicate rider rows are preserved for audit safety;
-- the application reuses the oldest matching company rider.
alter table public.riders
  drop constraint if exists riders_medicaid_id_key;

create index if not exists riders_company_medicaid_normalized_idx
  on public.riders (company_id, upper(btrim(medicaid_id)))
  where company_id is not null
    and medicaid_id is not null
    and btrim(medicaid_id) <> '';
