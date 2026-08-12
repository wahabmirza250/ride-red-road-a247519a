UPDATE public.medicaid_trips
SET status = 'submitted',
    submitted_confirmation = '9426224001006',
    robot_confirmation_number = '9426224001006',
    portal_confirmation = '9426224001006',
    portal_status = 'submitted',
    portal_submitted_at = '2026-08-12T06:15:14.215Z',
    submitted_at = '2026-08-12T06:15:14.215Z',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Reconciled: portal receipt confirmed claim 9426224001006 (Suspended). Automation timed out waiting for the page after clicking Confirm.',
    robot_last_checked_at = now()
WHERE id = '192d69e8-9215-4433-aea7-54322b7322df';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '9426224001006',
    submitted_at = '2026-08-12T06:15:14.215Z',
    submission_error = NULL,
    fix_notes = NULL,
    requires_human_step = false
WHERE trip_id = '192d69e8-9215-4433-aea7-54322b7322df';