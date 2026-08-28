-- =====================================================================
-- RedArt - CURRENT SCHEMA EXPORT (generated, do not edit by hand)
-- Part 8: views
-- Source: live `public` schema, catalog introspection, read-only.
-- Contains no data, no secrets, no cron/net schedules.
-- Execute the parts strictly in filename order (01 -> 10).
-- =====================================================================

CREATE OR REPLACE VIEW public.claim_status_queue_metrics AS
 SELECT br.company_id,
    c.name AS company_name,
    count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now() AND (br.status_check_locked_until IS NULL OR br.status_check_locked_until < now())) AS due_now,
    count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL AND br.status_check_locked_until >= now()) AS leased_running,
    count(*) FILTER (WHERE COALESCE(br.status_check_attempts, 0) > 0 AND br.status_check_next_at IS NOT NULL) AS retrying,
    count(*) FILTER (WHERE br.status_check_error IS NOT NULL) AS errored,
    count(*) FILTER (WHERE br.status = ANY (ARRAY['paid'::text, 'denied'::text, 'rejected'::text])) AS terminal,
    count(*) FILTER (WHERE br.status_check_next_at IS NOT NULL) AS scheduled_total,
    count(*) FILTER (WHERE br.status_checked_at IS NOT NULL AND br.status_checked_at >= (now() - '01:00:00'::interval)) AS checked_last_hour,
    count(*) FILTER (WHERE br.status_check_locked_until IS NOT NULL AND br.status_check_locked_until < (now() - '00:30:00'::interval)) AS stale_locks,
    avg(br.status_check_last_ms) FILTER (WHERE br.status_check_last_ms IS NOT NULL) AS avg_check_ms,
    min(br.status_check_next_at) FILTER (WHERE br.status_check_next_at IS NOT NULL AND br.status_check_next_at <= now()) AS oldest_due_at,
    max(br.status_checked_at) AS last_checked_at
   FROM billing_records br
     LEFT JOIN companies c ON c.id = br.company_id
  GROUP BY br.company_id, c.name;

CREATE OR REPLACE VIEW public.submission_queue_metrics AS
 SELECT br.company_id,
    c.name AS company_name,
    count(*) FILTER (WHERE br.status = 'queued'::text) AS queued,
    count(*) FILTER (WHERE br.status = 'queued'::text AND br.submit_next_attempt_at > now()) AS retrying,
    count(*) FILTER (WHERE br.status = 'submitting'::text) AS processing,
    count(*) FILTER (WHERE br.status = 'queued'::text AND br.submit_locked_until > now()) AS leased,
    count(*) FILTER (WHERE br.status = 'needs_fix'::text) AS needs_attention,
    count(*) FILTER (WHERE br.status = 'submitted'::text AND br.submitted_at > (now() - '01:00:00'::interval)) AS submitted_last_hour,
    count(*) FILTER (WHERE br.status = 'queued'::text AND br.submit_locked_until < (now() - '00:15:00'::interval)) AS stale_locks,
    min(br.updated_at) FILTER (WHERE br.status = 'queued'::text) AS oldest_queued_at,
    avg(br.submit_last_ms) FILTER (WHERE br.submit_last_ms IS NOT NULL) AS avg_submit_ms,
    max(br.submitted_at) AS last_submitted_at
   FROM billing_records br
     LEFT JOIN companies c ON c.id = br.company_id
  GROUP BY br.company_id, c.name;
