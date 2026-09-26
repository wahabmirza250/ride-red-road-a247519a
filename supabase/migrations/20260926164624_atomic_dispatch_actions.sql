-- One transaction for the request, trip and driver availability. Called only
-- by authenticated server handlers after their company/role checks.
create function public.update_company_dispatch_ride(
  _company_id uuid, _request_id uuid, _action text,
  _driver_id uuid default null, _trip_id uuid default null,
  _pickup_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  r public.ride_requests%rowtype;
  t public.trips%rowtype;
  finished_at timestamptz := now();
begin
  if _company_id is null or _action is null or _action not in ('complete','cancel','reschedule') then
    raise exception 'Invalid ride action';
  end if;
  select * into r from public.ride_requests where id=_request_id for update;
  if not found or r.company_id is distinct from _company_id then
    raise exception 'Ride request unavailable in this company';
  end if;
  if r.trip_id is not null then
    select * into t from public.trips where id=r.trip_id for update;
    if not found or (t.company_id is not null and t.company_id<>_company_id) then
      raise exception 'Linked trip unavailable in this company';
    end if;
  end if;
  if _action='complete' then
    if _driver_id is null or _trip_id is null or r.trip_id is distinct from _trip_id
      or r.driver_id is distinct from _driver_id or t.driver_id is distinct from _driver_id then
      raise exception 'Ride is not assigned to this driver';
    end if;
    if not exists(select 1 from public.drivers where id=_driver_id and company_id=_company_id) then
      raise exception 'Driver unavailable in this company';
    end if;
    if t.status::text='completed' and r.status::text='completed' then
      return jsonb_build_object('ok',true,'completed_at',t.actual_dropoff_time);
    end if;
    if t.status::text<>'in_progress' or r.status::text not in ('accepted','pending') then
      raise exception 'Only an active ride can be completed';
    end if;
    update public.trips set company_id=_company_id,status='completed',actual_dropoff_time=finished_at where id=t.id;
    update public.ride_requests set status='completed' where id=r.id;
  elsif _action='cancel' then
    if r.status::text='completed' or t.status::text='completed' then
      raise exception 'Completed rides cannot be cancelled';
    end if;
    update public.ride_requests set status='cancelled' where id=r.id;
    if t.id is not null then update public.trips set status='cancelled' where id=t.id; end if;
  else
    if _pickup_at is null or _pickup_at<=now() then raise exception 'Choose a future pickup time'; end if;
    if r.status::text not in ('pending','accepted') or (t.id is not null and t.status::text not in ('scheduled','assigned')) then
      raise exception 'This ride can no longer be rescheduled';
    end if;
    update public.ride_requests set requested_pickup_time=_pickup_at where id=r.id;
    if t.id is not null then update public.trips set scheduled_pickup_time=_pickup_at where id=t.id; end if;
    return jsonb_build_object('ok',true,'requested_pickup_time',_pickup_at);
  end if;
  -- Do not mark a driver idle if another active trip still needs them.
  update public.drivers d set status='available'
    where d.id=r.driver_id and d.company_id=_company_id and d.status::text='busy'
      and not exists(select 1 from public.trips other where other.driver_id=d.id and other.id is distinct from t.id
        and other.status::text in ('assigned','driver_en_route_to_pickup','arrived_at_pickup','in_progress'));
  return jsonb_build_object('ok',true,'completed_at',finished_at);
end;
$$;
revoke all on function public.update_company_dispatch_ride(uuid,uuid,text,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.update_company_dispatch_ride(uuid,uuid,text,uuid,uuid,timestamptz) to service_role;
