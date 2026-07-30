insert into public.drivers(id, user_id, status, current_lat, current_lng, last_location_at)
values ('99999999-1111-4111-8111-999999999999','ef656627-9699-4a35-a741-0e0767e5d295','available', 39.7392, -104.9903, now())
on conflict (user_id) do update set status='available';