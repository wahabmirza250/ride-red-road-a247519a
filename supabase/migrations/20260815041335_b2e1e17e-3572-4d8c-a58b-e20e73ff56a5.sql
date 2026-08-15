UPDATE public.medicaid_trips
SET status = 'submitted',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Verified from portal Claim Receipt (08/14/2026 10:09 PM MST): Professional Claim successfully submitted, status Paid. Claim ID 2326226001803.',
    robot_confirmation_number = '2326226001803',
    submitted_confirmation = '2326226001803',
    portal_confirmation = '2326226001803',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-15T04:09:38.884Z',
    submitted_at = '2026-08-15T04:09:38.884Z'
WHERE id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '2326226001803',
    submitted_at = '2026-08-15T04:09:38.884Z',
    submission_error = NULL,
    requires_human_step = false
WHERE trip_id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';

INSERT INTO public.billing_audit_log (billing_record_id, action, actor_type, notes)
SELECT id, 'manual_confirmation_recorded', 'system',
       'Unverified submit resolved by read-only portal receipt review: Claim ID 2326226001803, status Paid. No resubmission performed.'
FROM public.billing_records
WHERE trip_id = '52e5f9f7-7ed2-4e62-9a3f-9263ad4ac644';