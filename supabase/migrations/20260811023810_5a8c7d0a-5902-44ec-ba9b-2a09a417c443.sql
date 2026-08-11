ALTER TABLE public.passengers DROP CONSTRAINT IF EXISTS passengers_medicaid_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS passengers_company_medicaid_key
  ON public.passengers (company_id, medicaid_id)
  WHERE medicaid_id IS NOT NULL;
DROP INDEX IF EXISTS public.passengers_device_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS passengers_device_id_key
  ON public.passengers (device_id);