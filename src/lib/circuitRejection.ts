export function isSubmissionCircuitRejection(message: string | null | undefined): boolean {
return /^Automation service rejected the request \(503\):\s*\{\s*"error"\s*:\s*"SUBMISSION_CIRCUIT_OPEN"\s*[,}]/.test(String(message ?? '').trim());
}
export const CIRCUIT_REJECTION_MESSAGE = 'Not submitted: the robot refused this bill before starting because an earlier claim requires verification. Waiting for service recovery; bill details were not rejected.';
