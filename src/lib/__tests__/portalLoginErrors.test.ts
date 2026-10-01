import { describe, it, expect } from 'vitest';
import { sanitizeSubmitError, isInfrastructureSubmitError, isPreSubmitPacingCondition, classifySubmitFailure } from '../submitErrors';

describe('portal login errors are not worker shortages', () => {
  it('keeps a previous-session refusal out of automatic pacing retries', () => {
    const error = 'Automation service rejected request (503): PORTAL_SESSION_ACTIVE: You did not logoff your previous session.';
    expect(isInfrastructureSubmitError(error)).toBe(false);
    expect(isPreSubmitPacingCondition(error)).toBe(false);
    expect(classifySubmitFailure(error)).toEqual({stage:'portal_login',code:'portal_login'});
    expect(sanitizeSubmitError(error)).toContain('previous login session');
  });
  it('explains historic disabled login controls instead of blaming workers', () => {
    const error = "page.click: Timeout 30000ms exceeded. waiting for locator('text=Log In') LoginCmnButton element is not enabled";
    expect(isInfrastructureSubmitError(error)).toBe(false);
    expect(sanitizeSubmitError(error)).toContain('portal login');
  });
  it('reserves no-worker copy for fleet errors', () => {
    expect(sanitizeSubmitError('page.click: Timeout 30000ms exceeded')).not.toContain('No submission worker');
    expect(sanitizeSubmitError('No healthy submission robot')).toContain('No submission worker');
  });
  it('keeps an unresolved ledger claim out of ordinary resubmission', () => {
    const error='Automation service rejected request (409): CLAIM_UNCERTAIN';
    expect(classifySubmitFailure(error)).toEqual({stage:'portal_submit',code:'ambiguous_outcome'});
    expect(sanitizeSubmitError(error)).toContain('awaiting verification');
    expect(isPreSubmitPacingCondition(error)).toBe(false);
  });
});
