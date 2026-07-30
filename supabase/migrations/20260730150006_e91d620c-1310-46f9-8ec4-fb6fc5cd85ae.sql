insert into public.passengers (id, first_name, last_name, phone, medicaid_id, is_active)
values ('11111111-2222-3333-4444-555555555555','QA','MapTest','+13035550111','QA-MAP-0001', true)
on conflict (id) do nothing;

insert into public.drivers (id, user_id, status, current_lat, current_lng, last_location_at)
values ('22222222-3333-4444-5555-666666666666','ef656627-9699-4a35-a741-0e0767e5d295','busy',39.7392,-104.9903, now())
on conflict (id) do update set status='busy';

insert into public.user_roles (user_id, role) values ('ef656627-9699-4a35-a741-0e0767e5d295','driver')
on conflict do nothing;

insert into public.trips (id, passenger_id, driver_id, status, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_time, assignment_type)
values ('33333333-4444-5555-6666-777777777777','11111111-2222-3333-4444-555555555555','22222222-3333-4444-5555-666666666666','assigned','1200 Broadway, Denver, CO',39.7357,-104.9878,'Denver Health, 777 Bannock St, Denver, CO',39.7276,-104.9906, now(), 'manual')
on conflict (id) do nothing;