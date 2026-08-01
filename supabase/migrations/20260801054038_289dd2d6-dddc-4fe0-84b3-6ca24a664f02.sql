ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_captured_claim jsonb,
  ADD COLUMN IF NOT EXISTS robot_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS robot_pass text,
  ADD COLUMN IF NOT EXISTS robot_confirmation_number text;