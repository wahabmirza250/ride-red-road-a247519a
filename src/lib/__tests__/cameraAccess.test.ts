import { describe, it, expect } from 'vitest';
import { cameraAccess } from '../cameraAccess';
const driver = { id: 'driver-a', user_id: 'user-driver', company_id: 'company-a', merged_into: null };
describe('camera tenant and role authorization', () => {
  it('lets the driver publish only their own camera', () => {
    expect(cameraAccess({ driver, mode: 'publish', companyId: 'company-a', userId: 'user-driver', roles: ['driver'] })).toMatchObject({ canPublish: true, canSubscribe: false, room: 'camera-company-a-driver-a' });
    expect(() => cameraAccess({ driver, mode: 'publish', companyId: 'company-a', userId: 'other-driver', roles: ['driver'] })).toThrow();
  });
  it('gives same-company administrators receive-only access', () => {
    expect(cameraAccess({ driver, mode: 'view', companyId: 'company-a', userId: 'admin-a', roles: ['admin'] })).toMatchObject({ canPublish: false, canSubscribe: true });
  });
  it.each(['passenger', 'driver', 'dispatch', 'billing', 'platform_owner'])('rejects %s viewing', role => {
    expect(() => cameraAccess({ driver, mode: 'view', companyId: 'company-a', userId: 'user', roles: [role] })).toThrow();
  });
  it('rejects cross-company access even for administrators', () => {
    expect(() => cameraAccess({ driver, mode: 'view', companyId: 'company-b', userId: 'admin', roles: ['admin'] })).toThrow();
  });
  it('rejects removed drivers', () => {
    expect(() => cameraAccess({ driver: { ...driver, merged_into: 'another-driver' }, mode: 'view', companyId: 'company-a', userId: 'admin', roles: ['admin'] })).toThrow();
  });
});
