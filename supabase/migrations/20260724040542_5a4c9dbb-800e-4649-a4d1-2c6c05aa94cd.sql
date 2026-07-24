ALTER TABLE public.medicaid_trips
ADD COLUMN IF NOT EXISTS dispatch_trip_id uuid;

CREATE INDEX IF NOT EXISTS idx_medicaid_trips_dispatch_trip_id
ON public.medicaid_trips(dispatch_trip_id);

UPDATE public.medicaid_trips mt
SET dispatch_trip_id = t.id
FROM public.trips t
JOIN public.drivers d ON d.id = t.driver_id
JOIN public.passengers p ON p.id = t.passenger_id
JOIN public.riders r ON true
WHERE mt.dispatch_trip_id IS NULL
  AND r.id = mt.rider_id
  AND mt.driver_id = d.user_id
  AND mt.pickup_at = t.actual_pickup_time
  AND mt.odometer_start::integer = t.odometer_start
  AND mt.odometer_end::integer = t.odometer_end
  AND (
    lower(coalesce(r.full_name, '')) = lower(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')))
    OR (r.medicaid_id IS NOT NULL AND p.medicaid_id IS NOT NULL AND r.medicaid_id = p.medicaid_id)
  );