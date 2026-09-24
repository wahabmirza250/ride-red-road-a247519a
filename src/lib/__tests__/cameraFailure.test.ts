import { describe, expect, it } from 'vitest';
import { cameraFailure } from '../cameraFailure';

describe('camera failure recovery', () => {
  it('does not retry a denied permission or busy camera automatically', () => {
    for (const name of ['NotAllowedError', 'SecurityError', 'NotReadableError', 'AbortError', 'NotFoundError']) {
      expect(cameraFailure(Object.assign(new Error('device failure'), { name })).retryable).toBe(false);
    }
  });
  it('does not fight another device using the same driver account', () => {
    expect(cameraFailure(undefined, 'DUPLICATE_IDENTITY')).toMatchObject({ retryable: false, message: expect.stringContaining('another device') });
  });
  it('preserves the underlying connection failure for diagnosis', () => {
    expect(cameraFailure(new Error('could not establish pc connection'), 'JOIN_FAILURE')).toEqual({ retryable: true, message: expect.stringContaining('could not establish pc connection') });
  });
  it('allows recovery from a temporary media failure but not an administrator removal', () => {
    expect(cameraFailure(undefined, 'MEDIA_FAILURE').retryable).toBe(true);
    expect(cameraFailure(undefined, 'PARTICIPANT_REMOVED').retryable).toBe(false);
  });
});
