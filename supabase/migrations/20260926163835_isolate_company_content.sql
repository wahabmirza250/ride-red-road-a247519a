-- Company content must not be editable or visible across providers.
-- Unattributable legacy rows remain intact but hidden until an owner assigns them.
alter table public.events add column company_id uuid references public.companies(id)
  default public.current_user_company_id();
alter table public.news_items add column company_id uuid references public.companies(id)
  default public.current_user_company_id();
alter table public.games add column company_id uuid references public.companies(id)
  default public.current_user_company_id();

update public.events e set company_id=p.company_id from public.profiles p
  where e.created_by=p.id and e.company_id is null;

create index events_company_idx on public.events(company_id);
create index news_items_company_idx on public.news_items(company_id);
create index games_company_idx on public.games(company_id);

create policy company_content_isolation on public.events as restrictive for all
  using (company_id=public.current_user_company_id())
  with check (company_id=public.current_user_company_id());
create policy company_content_isolation on public.news_items as restrictive for all
  using (company_id=public.current_user_company_id())
  with check (company_id=public.current_user_company_id());
create policy company_content_isolation on public.games as restrictive for all
  using (company_id=public.current_user_company_id())
  with check (company_id=public.current_user_company_id());
