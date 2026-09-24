-- Read-only, tenant-scoped index across the existing storage models.
create or replace function public.admin_trip_page(
  p_page integer default 0, p_search text default '', p_status text default 'all',
  p_billing text default 'all', p_driver uuid default null,
  p_from timestamptz default null, p_to timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare company uuid; result jsonb;
begin
  if auth.uid() is null or not public.has_role(auth.uid(),'admin') then raise exception 'Admin access required'; end if;
  select company_id into company from public.profiles where id=auth.uid();
  if company is null then raise exception 'Company required'; end if;
  if p_page < 0 then raise exception 'Invalid page'; end if;
  with records as (
    select t.id,'dispatch'::text source,t.driver_id,t.scheduled_pickup_time at,t.status::text status,t.billing_status::text billing,
      t.pickup_address pickup,t.dropoff_address dropoff,concat_ws(' ',p.first_name,p.last_name) passenger,
      to_jsonb(t) as detail
    from trips t left join passengers p on p.id=t.passenger_id and p.company_id=company where t.company_id=company
    union all
    select m.id,'report',d.id,m.pickup_at,'completed',m.status::text,m.pickup_address,m.dropoff_address,r.full_name,
      jsonb_build_object('notes',m.review_notes,'actual_pickup_time',m.ride_started_at,'actual_dropoff_time',m.arrived_dropoff_at,'odometer_start',m.odometer_start,'odometer_end',m.odometer_end,'dispatch_trip_id',m.dispatch_trip_id)
    from medicaid_trips m left join drivers d on d.user_id=m.driver_id and d.company_id=company left join riders r on r.id=m.rider_id and r.company_id=company where m.company_id=company
    union all
    select f.id,'draft',d.id,f.created_at,
      case when f.payload#>>'{lifecycle,phase}' in ('to_pickup','at_pickup','in_trip','at_dropoff','leg_complete','ready_to_finish') then 'in_progress' else 'draft' end,
      'not_submitted',coalesce(f.payload#>>'{legs,0,pickup_address}',''),coalesce(f.payload#>>'{legs,0,dropoff_address}',''),coalesce(r.full_name,f.label,'Driver draft'),
      jsonb_build_object('notes','Driver workflow: '||coalesce(f.payload#>>'{lifecycle,phase}','draft'),'assigned_trip_id',f.assigned_trip_id)
    from driver_trip_drafts f left join drivers d on d.user_id=f.driver_id and d.company_id=company left join riders r on r.id=f.rider_id and r.company_id=company where f.company_id=company and f.status='in_progress' and not exists(select 1 from trips t where t.id=f.assigned_trip_id and t.company_id=company and t.status in ('driver_en_route_to_pickup','arrived_at_pickup','in_progress'))
    union all
    select r.id,'request',r.driver_id,coalesce(r.requested_pickup_time,r.created_at),case when r.driver_id is null then 'scheduled' else 'assigned' end,'not_submitted',r.pickup_address,r.dropoff_address,r.contact_name,jsonb_build_object('notes',r.notes)
    from ride_requests r where r.company_id=company and r.trip_id is null and r.status='pending'
  ), filtered as (
    select a.*,coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Unassigned') driver_name from records a
    left join drivers d on d.id=a.driver_id and d.company_id=company left join profiles p on p.id=d.user_id and p.company_id=company
    where (p_driver is null or a.driver_id=p_driver)
      and (p_from is null or a.at>=p_from) and (p_to is null or a.at<p_to)
      and (p_billing='all' or a.billing=p_billing)
      and (p_status='all' or a.status=p_status
        or (p_status='unassigned' and a.driver_id is null and a.status='scheduled')
        or (p_status='next' and a.status in ('scheduled','assigned') and a.at>=now())
        or (p_status='active' and a.status in ('in_progress','driver_en_route_to_pickup','arrived_at_pickup'))
        or (p_status='overdue' and a.at<now() and a.status in ('scheduled','assigned')))
      and (p_search='' or concat_ws(' ',a.id::text,a.pickup,a.dropoff,a.passenger,p.first_name,p.last_name) ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%')
  ), page as (select * from filtered order by case when p_status in ('unassigned','scheduled','next') then at end asc nulls last,at desc nulls last,source,id limit 50 offset p_page*50)
  select jsonb_build_object('count',(select count(*) from filtered),'rows',coalesce(jsonb_agg(detail || jsonb_build_object(
    'id',id,'source',source,'driver_id',driver_id,'driver_name',driver_name,'passenger_name',passenger,'scheduled_pickup_time',at,'status',status,'billing_status',billing,'pickup_address',pickup,'dropoff_address',dropoff
  ) order by case when p_status in ('unassigned','scheduled','next') then at end asc nulls last,at desc nulls last,source,id),'[]'::jsonb)) into result from page;
  return result;
end $$;
revoke all on function public.admin_trip_page(integer,text,text,text,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_trip_page(integer,text,text,text,uuid,timestamptz,timestamptz) to authenticated;

-- All staff assignment paths use this transaction. Lock the company queue first
-- so two dispatchers cannot both reserve one driver for overlapping pickups.
create or replace function public.admin_assign_trip(p_trip uuid,p_driver uuid,p_preview boolean default true,p_source text default 'dispatch')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare company uuid; trip trips%rowtype; request ride_requests%rowtype; driver drivers%rowtype; result jsonb;
begin
  if auth.uid() is null or not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'dispatch')) then raise exception 'Staff access required'; end if;
  select company_id into company from profiles where id=auth.uid();
  if company is null then raise exception 'Company required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(company::text,17));
  if p_source='request' then
    select * into request from ride_requests where id=p_trip and company_id=company for update;
    if not found or request.status<>'pending' or request.trip_id is not null then raise exception 'Request is no longer assignable'; end if;
    trip.id:=request.id; trip.driver_id:=request.driver_id; trip.status:='scheduled';
    trip.pickup_lat:=request.pickup_lat; trip.pickup_lng:=request.pickup_lng;
    trip.pickup_address:=request.pickup_address; trip.dropoff_address:=request.dropoff_address;
    trip.scheduled_pickup_time:=coalesce(request.requested_pickup_time,request.created_at);
    if coalesce(request.group_size,1)>1 then raise exception 'Group ride capacity requires manual vehicle planning'; end if;
  elsif p_source='dispatch' then
    select * into trip from trips where id=p_trip and company_id=company for update;
    if not found or trip.status not in ('scheduled','assigned') then raise exception 'Trip is no longer assignable'; end if;
  else raise exception 'Unsupported trip source'; end if;
  if trip.pickup_lat is null or trip.pickup_lng is null then raise exception 'Resolve the pickup address before assigning'; end if;
  if trip.scheduled_pickup_time < now()-interval '30 minutes' then raise exception 'Pickup is overdue. Reschedule before assigning.'; end if;
  select d.* into driver from drivers d where d.company_id=company and d.merged_into is null
    and (p_driver is null or d.id=p_driver) and d.status='available'
    and d.current_lat is not null and d.current_lng is not null and d.last_location_at between now()-interval '90 seconds' and now()+interval '30 seconds'
    and not exists(select 1 from trips t where t.company_id=company and t.driver_id=d.id and t.id<>trip.id and (
      t.status in ('in_progress','driver_en_route_to_pickup','arrived_at_pickup') or
      (t.status in ('scheduled','assigned') and abs(extract(epoch from t.scheduled_pickup_time-trip.scheduled_pickup_time))<7200)))
    and not exists(select 1 from ride_requests r where r.company_id=company and r.driver_id=d.id and r.id<>p_trip and r.status in ('pending','accepted') and (r.trip_id is null or r.trip_id<>trip.id) and abs(extract(epoch from coalesce(r.requested_pickup_time,r.created_at)-trip.scheduled_pickup_time))<7200)
    and not exists(select 1 from driver_trip_drafts f where f.company_id=company and f.driver_id=d.user_id and f.status='in_progress' and f.payload#>>'{lifecycle,phase}' in ('to_pickup','at_pickup','in_trip','at_dropoff','leg_complete','ready_to_finish'))
    -- Unknown group/capacity requirements require dispatcher planning.
    and not exists(select 1 from ride_requests r where r.trip_id=trip.id and (coalesce(r.group_size,1)>1 or (r.vehicle_type is not null and r.vehicle_type::text<>d.default_vehicle_type::text)))
    and (p_source<>'request' or request.vehicle_type is null or request.vehicle_type::text=d.default_vehicle_type::text)
    order by acos(least(1.0,greatest(-1.0,sin(radians(d.current_lat))*sin(radians(trip.pickup_lat))+cos(radians(d.current_lat))*cos(radians(trip.pickup_lat))*cos(radians(d.current_lng-trip.pickup_lng))))),d.id
    limit 1 for update;
  if not found then raise exception 'No eligible driver with fresh GPS and a clear two-hour pickup window. Use Dispatch to review availability and vehicle needs.'; end if;
  result:=jsonb_build_object('trip_id',trip.id,'driver_id',driver.id,'driver_user_id',driver.user_id,'pickup',trip.pickup_address,'dropoff',trip.dropoff_address,'rule','Nearest fresh GPS; available driver; no active ride; two-hour pickup buffer');
  if p_preview then return result; end if;
  if p_driver is null then raise exception 'Preview and select a driver first'; end if;
  if trip.driver_id=driver.id then return result||jsonb_build_object('changed',false); end if;
  if p_source='request' then
    update ride_requests set driver_id=driver.id,offer_expires_at=now()+interval '10 minutes',declined_driver_ids='{}' where id=request.id;
  else
    update trips set driver_id=driver.id,status='assigned',assignment_type='manual' where id=trip.id;
    update ride_requests set driver_id=driver.id where trip_id=trip.id and company_id=company;
  end if;
  return result||jsonb_build_object('changed',true);
end $$;
revoke all on function public.admin_assign_trip(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.admin_assign_trip(uuid,uuid,boolean,text) to authenticated;
