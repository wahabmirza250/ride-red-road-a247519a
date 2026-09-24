import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNativePush } from '../native';

const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(),
  register: vi.fn(), addListener: vi.fn(), removeAllListeners: vi.fn(),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));

describe('native push registration', () => {
  let callbacks: Record<string, (value: any) => void>;
  let removers: ReturnType<typeof vi.fn>[];
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    callbacks = {};
    removers = [];
    push.checkPermissions.mockResolvedValue({ receive: 'granted' });
    push.addListener.mockImplementation(async (event, callback) => {
      callbacks[event] = callback;
      const remove = vi.fn().mockResolvedValue(undefined);
      removers.push(remove);
      return { remove };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('captures a token emitted immediately during registration and preserves other listeners', async () => {
    push.register.mockImplementation(async () => callbacks.registration({ value: 'device-token' }));
    expect(await registerNativePush()).toBe('device-token');
    expect(removers).toHaveLength(2);
    removers.forEach(remove => expect(remove).toHaveBeenCalledOnce());
    expect(push.removeAllListeners).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when registration rejects', async () => {
    push.register.mockRejectedValue(new Error('FCM unavailable'));
    expect(await registerNativePush()).toBeNull();
    removers.forEach(remove => expect(remove).toHaveBeenCalledOnce());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even when the native registration promise never settles', async () => {
    push.register.mockReturnValue(new Promise(() => {}));
    const result = registerNativePush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeNull();
    removers.forEach(remove => expect(remove).toHaveBeenCalledOnce());
  });
});
