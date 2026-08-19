DELETE FROM public.driver_payouts WHERE bonus_note = 'test bonus';

DELETE FROM public.driver_shifts ds
USING public.drivers d, public.profiles p
WHERE ds.driver_id = d.id AND d.user_id = p.id
  AND upper(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE 'YIBRAH%'
  AND ds.clock_in_at::date = DATE '2026-08-10';

DELETE FROM public.driver_pay dp
USING public.drivers d, public.profiles p
WHERE dp.driver_id = d.id AND d.user_id = p.id
  AND upper(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE 'YIBRAH%'
  AND dp.hourly_rate = 20;
