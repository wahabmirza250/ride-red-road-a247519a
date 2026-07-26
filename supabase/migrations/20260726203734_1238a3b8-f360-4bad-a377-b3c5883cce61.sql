ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

UPDATE public.ride_requests
   SET vehicle_type = lower(substring(notes from '\[VEHICLE:([a-zA-Z_]+)\]'))
 WHERE vehicle_type IS NULL
   AND notes ~ '\[VEHICLE:';