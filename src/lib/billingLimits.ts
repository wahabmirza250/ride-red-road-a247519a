/** Company policy: limits apply to the whole bill, including all return legs. */
export const MAX_BILL_MILES = 50;
export const MAX_BILL_UNITS = 2;

export function billingLimitIssues(record: any): string[] {
  const issues: string[] = [];
  const present = (v: any) => v !== undefined && v !== null && v !== '';
  const check = (values: any[], max: number, label: string) => {
    if (values.filter(present).some(v => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > max))
      issues.push(`Billing blocked: ${label} must not exceed ${max} per bill. Review the original trip; do not split or reduce it automatically.`);
  };
  check([record.miles, record.billed_miles, record.mileage_units, record.total_miles], MAX_BILL_MILES, 'total miles');
  check([record.trip_units, record.units, record.trip_unit_count, record.base_units], MAX_BILL_UNITS, 'trip units');
  const legs = record.odometer_legs ?? record.legs ?? record.trip_legs ?? record.corrected_legs;
  if (Array.isArray(legs) && legs.length) {
    check([legs.length], MAX_BILL_UNITS, 'trip units');
    check([legs.reduce((sum: number, l: any) => sum + Number(l.dropoff_odometer) - Number(l.pickup_odometer), 0)], MAX_BILL_MILES, 'total miles');
  }
  for (const lines of [record.service_lines, record.claim_service_lines, record.corrected_service_lines, record.resubmission_service_lines]) {
    if (!Array.isArray(lines)) continue;
    const isMileage = (l: any) => /mile/i.test(String(l.unit_type ?? l.unit_word ?? '')) || /^(S0215|A0425)$/i.test(String(l.procedure_code ?? l.code ?? ''));
    check([lines.filter(isMileage).reduce((s: number, l: any) => s + Number(l.units ?? l.miles ?? 0), 0)], MAX_BILL_MILES, 'total miles');
    check([lines.filter((l: any) => !isMileage(l)).reduce((s: number, l: any) => s + Number(l.units ?? 0), 0)], MAX_BILL_UNITS, 'trip units');
  }
  return [...new Set(issues)];
}

export function assertBillingLimits(record: any): void {
  const issue = billingLimitIssues(record)[0];
  if (issue) throw new Error(issue);
}
