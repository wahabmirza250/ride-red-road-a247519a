-- Transactional passenger alerts: callers cannot enqueue arbitrary recipients.
create table public.ride_push_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('trip','request')),
  source_id uuid not null,
  status text not null,
  driver_id uuid,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz,
  outcome text
);
create index ride_push_pending on public.ride_push_outbox(next_attempt_at) where sent_at is null;
alter table public.ride_push_outbox enable row level security;
revoke all on public.ride_push_outbox from public, anon, authenticated;
grant all on public.ride_push_outbox to service_role;

create or replace function public.enqueue_passenger_ride_push()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare recipient uuid; source_kind text; event_key text;
begin
  if new.company_id is null then return new; end if;
  if tg_table_name = 'trips' then
    if new.status::text not in ('assigned','driver_en_route_to_pickup','arrived_at_pickup','in_progress','completed','cancelled') then return new; end if;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.driver_id is not distinct from old.driver_id then return new; end if;
    if new.status::text = 'assigned' and new.driver_id is null then return new; end if;
    select user_id into recipient from public.passengers where id = new.passenger_id and company_id = new.company_id;
    source_kind := 'trip';
  else
    -- Linked trips produce their own alerts; avoid duplicate cancellation alerts.
    if new.trip_id is not null or new.status::text <> 'cancelled' then return new; end if;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
    recipient := new.passenger_id;
    source_kind := 'request';
  end if;
  if recipient is null or not exists (
    select 1 from public.profiles p join public.companies c on c.id=p.company_id
    join public.user_roles r on r.user_id=p.id and r.company_id=p.company_id and r.role='passenger'
    where p.id=recipient and p.company_id=new.company_id and p.is_active and c.status='active'
  ) then return new; end if;
  event_key := source_kind || ':' || new.id::text || ':' || new.status::text || ':' || coalesce(new.driver_id::text,'none');
  insert into public.ride_push_outbox(company_id,user_id,source_type,source_id,status,driver_id,dedupe_key)
  values(new.company_id,recipient,source_kind,new.id,new.status::text,new.driver_id,event_key)
  on conflict(dedupe_key) do nothing;
  return new;
end $$;
revoke all on function public.enqueue_passenger_ride_push() from public, anon, authenticated;
create trigger passenger_trip_push after insert or update of status, driver_id on public.trips
  for each row execute function public.enqueue_passenger_ride_push();
create trigger passenger_request_push after insert or update of status on public.ride_requests
  for each row execute function public.enqueue_passenger_ride_push();

-- Lease one event at a time; concurrent server replicas cannot claim the same row.
create function public.claim_passenger_ride_push()
returns setof public.ride_push_outbox language sql security definer set search_path = pg_catalog, public as $$
  update public.ride_push_outbox o set attempts=o.attempts+1, next_attempt_at=now()+interval '2 minutes'
  where o.id = (
    select id from public.ride_push_outbox where sent_at is null and attempts<5
      and next_attempt_at<=now() and expires_at>now()
    order by created_at for update skip locked limit 1
  ) returning o.*;
$$;
revoke all on function public.claim_passenger_ride_push() from public, anon, authenticated;
grant execute on function public.claim_passenger_ride_push() to service_role;
