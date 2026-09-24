export type CameraMode = 'publish' | 'view';

export function cameraAccess(input: {
  mode: CameraMode; userId: string; companyId: string; roles: string[];
  driver: { id: string; user_id: string; company_id: string | null; merged_into: string | null };
}) {
  const { mode, userId, companyId, roles, driver } = input;
  if (!companyId || driver.company_id !== companyId || driver.merged_into) throw new Error('Camera access denied');
  if (mode === 'publish') {
    if (!roles.includes('driver') || driver.user_id !== userId) throw new Error('Camera access denied');
  } else if (!roles.includes('admin')) {
    throw new Error('Only company administrators can view cameras');
  }
  return {
    room: `camera-${companyId}-${driver.id}`,
    identity: mode === 'publish' ? `driver-${driver.id}` : `viewer-${userId}`,
    canPublish: mode === 'publish', canSubscribe: mode === 'view',
  };
}
