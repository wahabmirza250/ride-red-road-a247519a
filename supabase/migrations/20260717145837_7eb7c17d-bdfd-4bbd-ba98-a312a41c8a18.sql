
ALTER TABLE public.medicaid_trips
  ADD COLUMN IF NOT EXISTS robot_job_id text,
  ADD COLUMN IF NOT EXISTS robot_job_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS robot_last_status text,
  ADD COLUMN IF NOT EXISTS robot_last_message text,
  ADD COLUMN IF NOT EXISTS robot_last_checked_at timestamptz;
