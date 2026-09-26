import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ roles: [] as any[], send: vi.fn() }));
vi.mock('../nativePushSend.server', () => ({ sendNativePushToUsers: state.send }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: () => {
  let rows = state.roles;
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return query; }, then: (resolve: any) => Promise.resolve({data: rows, error: null}).then(resolve) };
  return query;
} } }));
import { sendPushToAdmins, sendPushToAllPassengers } from '../pushSend.server';
describe('company notification recipients', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    state.send.mockReset().mockResolvedValue({sent: 1, failed: 0});
    state.roles = ['a', 'b'].flatMap(company_id => ['admin', 'passenger'].map(role => ({company_id, role, user_id: `${company_id}-${role}`})));
  });
  it.each([['admin', sendPushToAdmins], ['passenger', sendPushToAllPassengers]] as const)('sends only to this company’s %s accounts', async (role, send) => {
    await send('a', {title: 'Test', body: 'Test'});
    expect(state.send).toHaveBeenCalledWith([`a-${role}`], {title: 'Test', body: 'Test'});
  });
  it('fails closed when company is missing', async () => {
    await expect(sendPushToAllPassengers('', {title: 'Test', body: 'Test'})).rejects.toThrow('Company required');
    expect(state.send).not.toHaveBeenCalled();
  });
});
