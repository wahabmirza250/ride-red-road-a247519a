create table public.company_rewards_settings (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  rides_required integer not null default 15 check(rides_required>0),
  period_type text not null default 'weekly' check(period_type in ('weekly','monthly')),
  prize_description text not null default '$25 Gift Card',
  winners_per_period integer not null default 1 check(winners_per_period>0),
  updated_at timestamptz not null default now()
);
insert into public.company_rewards_settings(company_id,enabled,rides_required,period_type,prize_description,winners_per_period)
  select c.id,s.enabled,s.rides_required,s.period_type,s.prize_description,s.winners_per_period
  from public.companies c cross join public.rewards_settings s;
alter table public.company_rewards_settings enable row level security;
grant select on public.company_rewards_settings to authenticated;
grant all on public.company_rewards_settings to service_role;
create policy company_rewards_read on public.company_rewards_settings for select to authenticated
  using(company_id=public.current_user_company_id());

alter table public.contest_entries add column company_id uuid references public.companies(id);
alter table public.contest_winners add column company_id uuid references public.companies(id);
update public.contest_entries e set company_id=p.company_id from public.passengers p where p.id=e.passenger_id;
update public.contest_winners e set company_id=p.company_id from public.passengers p where p.id=e.passenger_id;
create index contest_entries_company_period_idx on public.contest_entries(company_id,period_start);
create index contest_winners_company_period_idx on public.contest_winners(company_id,period_start);
create policy rewards_company_isolation on public.contest_entries as restrictive for all
  using(company_id=public.current_user_company_id()) with check(company_id=public.current_user_company_id());
create policy rewards_company_isolation on public.contest_winners as restrictive for all
  using(company_id=public.current_user_company_id()) with check(company_id=public.current_user_company_id());

-- Serialize draws for one company/period so two admin clicks cannot draw twice.
create function public.draw_company_rewards(_company_id uuid,_period_start date,_period_end date)
returns integer language plpgsql security invoker set search_path=public as $$
declare s public.company_rewards_settings%rowtype; drawn integer;
begin
  if _company_id is null then raise exception 'Company required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_company_id::text||':'||_period_start::text,0));
  select * into s from public.company_rewards_settings where company_id=_company_id;
  if not found or not s.enabled then raise exception 'Rewards are paused'; end if;
  if exists(select 1 from public.contest_winners where company_id=_company_id and period_start=_period_start) then
    raise exception 'Winners already drawn for this period';
  end if;
  insert into public.contest_winners(company_id,passenger_id,period_start,period_end,prize_description)
    select _company_id,e.passenger_id,_period_start,_period_end,s.prize_description
    from public.contest_entries e join public.passengers p on p.id=e.passenger_id and p.company_id=_company_id
    where e.company_id=_company_id and e.period_start=_period_start and e.ride_count>=s.rides_required
    order by random() limit s.winners_per_period;
  get diagnostics drawn=row_count;
  if drawn=0 then raise exception 'No qualified entrants this period'; end if;
  return drawn;
end;
$$;
revoke all on function public.draw_company_rewards(uuid,date,date) from public,anon,authenticated;
grant execute on function public.draw_company_rewards(uuid,date,date) to service_role;
