UPDATE public.medicaid_trips
SET status = 'submitted',
    robot_last_status = 'SUBMITTED',
    robot_last_message = 'Resolved by read-only portal receipt lookup: Claim ID 2326227001003, portal status Paid. Not resubmitted.',
    robot_last_checked_at = now(),
    robot_confirmation_number = '2326227001003',
    submitted_confirmation = '2326227001003',
    portal_confirmation = '2326227001003',
    portal_status = 'submitted',
    portal_submitted_at = now(),
    submitted_at = COALESCE(submitted_at, now()),
    updated_at = now()
WHERE id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';

UPDATE public.billing_records
SET status = 'submitted',
    state_confirmation_number = '2326227001003',
    submitted_at = COALESCE(submitted_at, now()),
    submission_error = NULL,
    requires_human_step = false,
    updated_at = now()
WHERE trip_id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';

INSERT INTO public.billing_audit_log (billing_record_id, action, actor_type, notes)
SELECT id, 'manual_portal_lookup_resolved', 'system',
       'Job ended SUBMITTED_UNVERIFIED. Read-only portal receipt confirmed Claim ID 2326227001003 (status Paid) for Pablo Soto / L085312. Record resolved without resubmitting.'
FROM public.billing_records WHERE trip_id = '1cadfa63-3389-4c21-b30d-d15ad62265dd';