export function cameraFailure(error: unknown, reason?: string): { message: string; retryable: boolean } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { message: 'Camera permission was denied. Allow camera access in Android settings, then try again.', retryable: false };
  if (name === 'NotReadableError' || name === 'AbortError') return { message: 'The camera could not start. Close other apps using the camera, then try again.', retryable: false };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { message: 'No usable camera was found. Check that the tablet camera is available, then try again.', retryable: false };
  if (reason === 'DUPLICATE_IDENTITY') return { message: 'This driver account opened the camera on another device. Close the other driver app, then try again on this tablet.', retryable: false };
  if (reason === 'PARTICIPANT_REMOVED' || reason === 'ROOM_DELETED') return { message: 'The camera session was closed by the service. Contact your administrator or try again.', retryable: false };
  const detail = error instanceof Error ? error.message : '';
  return {
    message: `Could not connect live video${reason ? ` (${reason})` : ''}. Check the tablet’s internet connection and try again.${detail ? ` ${detail}` : ''}`,
    retryable: true,
  };
}
