-- Dispatch passengers are tenant-scoped. Normalize Medicaid IDs so casing
-- and surrounding spaces cannot create duplicates inside one company.
drop index if exists public.passengers_company_medicaid_key;

create unique index if not exists passengers_company_medicaid_normalized_key
  on public.passengers (company_id, upper(btrim(medicaid_id)))
  where company_id is not null
    and medicaid_id is not null
    and btrim(medicaid_id) <> '';

-- When a company has exactly one portal credential, it is safe to use it as
-- the billing default. This repairs newly-created company profiles such as
-- Lamar without hard-coding a company or credential.
update public.billing_settings as bs
set default_portal_id = one_credential.portal_id,
    updated_at = now()
from (
  select company_id, min(portal_id) as portal_id
  from public.state_portal_credentials
  where company_id is not null
  group by company_id
  having count(*) = 1
) as one_credential
where bs.company_id = one_credential.company_id
  and bs.default_portal_id is null;
