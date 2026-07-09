import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildVapidPartyXmtpRegistrationPayload,
  disablePush,
  enablePushForCurrentUser,
  getPushPermissionStatus,
  isPushEnabled,
  normalizeXmtpHmacKeys,
  type XmtpPushIdentity,
  type XmtpPushTopic,
} from './subscribe';
import { registerServiceWorkerForPush } from './index';
/* eslint-disable @typescript-eslint/no-explicit-any */

const identity: XmtpPushIdentity = {
  inboxId: 'inbox-1',
  installationId: 'install-1',
  address: '0x1234567890123456789012345678901234567890',
};

const topics: XmtpPushTopic[] = [
  {
    topic: '/xmtp/mls/1/g-topic',
    hmacKeys: [{ epoch: '1', key: 'AQID' }],
  },
];

function createSubscription(endpoint = 'https://push.example/subscription') {
  return {
    endpoint,
    expirationTime: null,
    getKey: (name: string) =>
      name === 'p256dh'
        ? new Uint8Array([1, 2, 3]).buffer
        : new Uint8Array([4, 5, 6]).buffer,
    unsubscribe: vi.fn(async () => true),
  };
}

function installPushBrowserMocks({
  subscription,
  existingSubscription = null,
}: {
  subscription: ReturnType<typeof createSubscription>;
  existingSubscription?: unknown;
}) {
  const getSubscription = existingSubscription
    ? vi.fn(async () => existingSubscription)
    : vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(subscription);
  const pushManager = {
    subscribe: vi.fn(async () => subscription),
    getSubscription,
  };
  const registration = { scope: 'https://converge.cv/', pushManager };
  const navigatorMock = {
    userAgent: 'vitest',
    serviceWorker: {
      ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration),
      register: vi.fn(async () => registration),
      getRegistration: vi
        .fn<() => Promise<ServiceWorkerRegistration | null>>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(registration as unknown as ServiceWorkerRegistration),
    },
  } as unknown as Navigator;

  const notificationMock = function Notification() {} as unknown as typeof Notification;
  (notificationMock as any).requestPermission = vi.fn(async () => 'granted');
  (notificationMock as any).permission = 'granted';

  const pushManagerCtor = function PushManager() {} as unknown as typeof PushManager;
  vi.stubGlobal('PushManager', pushManagerCtor);
  (window as any).PushManager = pushManagerCtor;
  vi.stubGlobal('navigator', navigatorMock);
  vi.stubGlobal('Notification', notificationMock);

  return { navigatorMock, pushManager, registration };
}

describe('push helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).PushManager;
  });

  it('normalizes XMTP HMAC key maps for vapid.party', () => {
    const normalized = normalizeXmtpHmacKeys(
      new Map([
        [
          '/xmtp/mls/1/topic-a',
          [
            {
              key: new Uint8Array([1, 2, 3]),
              epoch: 7n,
            },
          ],
        ],
      ]),
    );

    expect(normalized).toEqual([
      {
        topic: '/xmtp/mls/1/topic-a',
        hmacKeys: [{ epoch: '7', key: 'AQID' }],
      },
    ]);
  });

  it('builds a minimal XMTP registration payload without plaintext message content', () => {
    const payload = buildVapidPartyXmtpRegistrationPayload({
      identity,
      subscription: {
        endpoint: 'https://push.example/subscription',
        expirationTime: null,
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      topics,
      registeredAt: '2026-07-09T00:00:00.000Z',
    });

    expect(payload.identity).toEqual(identity);
    expect(payload.preferences).toEqual({
      minimalPayloadOnly: true,
      plaintextPreview: false,
    });
    expect(payload.xmtp.topics).toEqual(topics);
    expect(JSON.stringify(payload)).not.toMatch(/messageBody|previewText|body/);
  });

  it('enables push by subscribing and posting the XMTP registration to vapid.party without an API key', async () => {
    const subscription = createSubscription();
    const { navigatorMock, pushManager } = installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async (_url, _init) =>
      new Response(JSON.stringify({ success: true, data: { id: 'registration-1' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as Mock;

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik',
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      success: true,
      endpoint: subscription.endpoint,
      registrationId: 'registration-1',
      topicCount: 1,
    });
    expect(navigatorMock.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(pushManager.subscribe).toHaveBeenCalled();

    const lastCall = fetchFn.mock.calls[fetchFn.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe('https://vapid.party/api/xmtp/subscriptions');
    expect(lastCall?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.stringify(lastCall?.[1]?.headers)).not.toMatch(/X-API-Key/i);
    const body = JSON.parse(String(lastCall?.[1]?.body));
    expect(body.identity).toEqual(identity);
    expect(body.xmtp.topics).toEqual(topics);

    await disablePush({
      identity,
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('reuses an existing subscription when present', async () => {
    const subscription = createSubscription('https://push.example/existing');
    const { pushManager } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as Mock;

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).toHaveBeenCalled();
  });

  it('reports unsupported permission state when Notification is missing', () => {
    const globals = globalThis as any;
    delete globals.Notification;
    delete (window as any).Notification;
    expect(getPushPermissionStatus()).toBe('unsupported');
  });

  it('returns error when permission denied', async () => {
    const subscription = createSubscription();
    installPushBrowserMocks({ subscription });
    const notificationMock = function Notification() {} as unknown as typeof Notification;
    (notificationMock as any).requestPermission = vi.fn(async () => 'denied');
    (notificationMock as any).permission = 'denied';
    vi.stubGlobal('Notification', notificationMock);

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it('returns false when no service worker registration exists', async () => {
    const pushManagerCtor = function PushManager() {} as unknown as typeof PushManager;
    vi.stubGlobal('PushManager', pushManagerCtor);
    (window as any).PushManager = pushManagerCtor;
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
