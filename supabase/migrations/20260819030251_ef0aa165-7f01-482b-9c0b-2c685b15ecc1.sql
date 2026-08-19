DELETE FROM public.passengers p
WHERE p.user_id IS NULL
  AND p.medicaid_id LIKE 'SELF-%'
  AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_entries c WHERE c.passenger_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.contest_winners w WHERE w.passenger_id = p.id);
