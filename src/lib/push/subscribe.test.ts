import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disablePush,
  enablePushForCurrentUser,
  getPushPermissionStatus,
  isPushEnabled,
} from './subscribe';
import { registerServiceWorkerForPush } from './index';

const originalFetch = global.fetch;

describe('push helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it('enables push by subscribing and posting to vapid.party', async () => {
    const subscription = {
      endpoint: 'https://push.example/subscription',
      getKey: (name: string) =>
        name === 'p256dh'
          ? new Uint8Array([1, 2, 3]).buffer
          : new Uint8Array([4, 5, 6]).buffer,
      unsubscribe: vi.fn(async () => true),
    };
    const pushManager = {
      subscribe: vi.fn(async () => subscription),
      getSubscription: vi.fn(async () => subscription),
    };
    const registration = { pushManager };
    const navigatorMock = {
      serviceWorker: {
        ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration),
        register: vi.fn(async () => registration),
        getRegistration: vi.fn(async () => registration),
      },
    } as unknown as Navigator;

    const notificationMock = function Notification() {} as unknown as typeof Notification;
    (notificationMock as any).requestPermission = vi.fn(async () => 'granted');
    (notificationMock as any).permission = 'granted';

    const pushManagerCtor = function PushManager() {} as unknown as typeof PushManager;
    vi.stubGlobal('PushManager', pushManagerCtor);
    // ensure window check passes
    (window as any).PushManager = pushManagerCtor;
    vi.stubGlobal('navigator', navigatorMock);
    vi.stubGlobal('Notification', notificationMock);
    global.fetch = vi.fn(
      async (_url, init) => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    ) as unknown as vi.Mock;

    const result = await enablePushForCurrentUser({ userId: 'inbox-1', channelId: 'main' });

    expect(result.success).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalled();
    const lastCall = (fetch as unknown as vi.Mock).mock.calls.at(-1);
    expect(lastCall?.[1]?.body).toContain('inbox-1');

    await disablePush();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('reports unsupported permission state when Notification is missing', () => {
    // @ts-expect-error - simulate missing API
    delete (globalThis as any).Notification;
    // @ts-expect-error
    delete (window as any).Notification;
    expect(getPushPermissionStatus()).toBe('unsupported');
  });

  it('returns error when permission denied', async () => {
    const navigatorMock = {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { subscribe: vi.fn() } } as any),
      },
    } as unknown as Navigator;
    vi.stubGlobal('navigator', navigatorMock);
    const notificationMock = function Notification() {} as unknown as typeof Notification;
    (notificationMock as any).requestPermission = vi.fn(async () => 'denied');
    (notificationMock as any).permission = 'denied';
    vi.stubGlobal('Notification', notificationMock);

    const result = await enablePushForCurrentUser();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/supported|permission/i);
  });

  it('returns false when no service worker registration exists', async () => {
    const navigatorMock = {
      serviceWorker: { getRegistration: vi.fn(async () => null) },
    } as unknown as Navigator;
    vi.stubGlobal('navigator', navigatorMock);
    vi.stubGlobal('Notification', function Notification() {} as unknown as typeof Notification);

    const enabled = await isPushEnabled();
    expect(enabled).toBe(false);
  });

  it('skips service worker registration when unsupported', async () => {
    vi.stubGlobal('navigator', {} as Navigator);
    const result = await registerServiceWorkerForPush();
    expect(result).toBeNull();
  });
});
