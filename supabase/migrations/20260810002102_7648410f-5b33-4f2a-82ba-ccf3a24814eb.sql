ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_drivers integer,
  ADD COLUMN IF NOT EXISTS max_dispatchers integer,
  ADD COLUMN IF NOT EXISTS max_billers integer,
  ADD COLUMN IF NOT EXISTS max_admins integer;