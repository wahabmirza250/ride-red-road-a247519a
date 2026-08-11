-- 1. Remove older duplicates, keeping the most recently updated row per
--    (company_id, vehicle_type, unit_type).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, vehicle_type, unit_type
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
    FROM public.billing_rate_settings
   WHERE company_id IS NOT NULL
)
DELETE FROM public.billing_rate_settings b
 USING ranked r
 WHERE b.id = r.id AND r.rn > 1;

-- Same treatment for any legacy rows with no company set.
WITH ranked_null AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vehicle_type, unit_type
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
    FROM public.billing_rate_settings
   WHERE company_id IS NULL
)
DELETE FROM public.billing_rate_settings b
 USING ranked_null r
 WHERE b.id = r.id AND r.rn > 1;

-- 2. Structural guarantee: one rate row per company + vehicle type + unit type.
CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_company_vehicle_unit_key
  ON public.billing_rate_settings (company_id, vehicle_type, unit_type)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_nocompany_vehicle_unit_key
  ON public.billing_rate_settings (vehicle_type, unit_type)
  WHERE company_id IS NULL;

-- 3. Also make the exact combination requested unique (implied by the above,
--    but explicit so a procedure-code change can never fork a second row).
CREATE UNIQUE INDEX IF NOT EXISTS billing_rate_settings_company_vehicle_unit_proc_key
  ON public.billing_rate_settings (company_id, vehicle_type, unit_type, procedure_code)
  WHERE company_id IS NOT NULL;