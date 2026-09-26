alter table public.companies add column if not exists is_demo boolean not null default false;
alter table public.companies add column if not exists demo_owner_id uuid references auth.users(id);
create unique index if not exists companies_demo_owner_uniq on public.companies(demo_owner_id) where is_demo;
comment on column public.companies.is_demo is 'Isolated presentation company. External submissions and notifications are disabled.';

create or replace function public.keep_demo_company_isolated() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.is_demo and (not new.is_demo or new.demo_owner_id is distinct from old.demo_owner_id) then
    raise exception 'A demo company cannot be converted or reassigned';
  end if;
  return new;
end; $$;
create trigger keep_demo_company_isolated before update on public.companies
for each row execute function public.keep_demo_company_isolated();
