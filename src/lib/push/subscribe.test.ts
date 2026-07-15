import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildXmtpAlertRegistrationPayload,
  buildXmtpAlertUnregistrationPayload,
  buildVapidPartyXmtpRegistrationPayload,
  cacheInboxPushRegistration,
  clearPushActivityForInbox,
  disablePush,
  enablePushForLoadedInboxes,
  enablePushForCurrentUser,
  getAppPushStatus,
  getBrowserPushSubscriptionState,
  getPushPermissionStatus,
  getXmtpPushServiceStatus,
  isPushEnabled,
  isPushRegistrationRefreshReady,
  listPendingPushActivity,
  listenForPushActivityCleared,
  normalizeXmtpGroupTopic,
  normalizeXmtpHmacKeys,
  normalizeXmtpPushTopics,
  refreshPushRegistrationForInbox,
  removePushRegistrationForInbox,
  updatePushInboxProfile,
  type XmtpPushIdentity,
  type XmtpPushTopic,
} from './subscribe';
import { MemoryPushStateStore, pushRegistrationKey } from './state';
import { registerServiceWorkerForPush } from './index';
/* eslint-disable @typescript-eslint/no-explicit-any */

const GROUP_ID_A = 'a'.repeat(32);
const GROUP_ID_B = 'b'.repeat(32);
const GROUP_TOPIC_A = `/xmtp/mls/1/g-${GROUP_ID_A}/proto`;
const GROUP_TOPIC_B = `/xmtp/mls/1/g-${GROUP_ID_B}/proto`;
const INSTALLATION_ID_A = '1'.repeat(64);
const INSTALLATION_ID_B = '2'.repeat(64);
const INSTALLATION_ID_OLD = '3'.repeat(64);
const INSTALLATION_ID_NEW = '4'.repeat(64);
const TEST_VAPID_PUBLIC_KEY = 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik';

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(
    atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')),
    (character) => character.charCodeAt(0),
  );
}

const identity: XmtpPushIdentity = {
  inboxId: 'inbox-1',
  installationId: INSTALLATION_ID_A,
  address: '0x1234567890123456789012345678901234567890',
};

const topics: XmtpPushTopic[] = [
  {
    topic: GROUP_TOPIC_A,
    hmacKeys: [{ epoch: '1', key: 'AQID' }],
  },
];

function registrationResponse(status = 200, receipt = 'r'.repeat(43)): Response {
  return new Response(JSON.stringify({
    success: true,
    data: {
      diagnostics: {
        receipt,
        statusPath: '/api/xmtp/status',
        testPath: '/api/xmtp/status/test',
      },
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSubscription(
  endpoint = 'https://push.example/subscription',
  applicationServerKey = decodeBase64Url(TEST_VAPID_PUBLIC_KEY),
) {
  return {
    endpoint,
    expirationTime: null,
    options: { applicationServerKey: applicationServerKey.buffer },
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
  const registration = { scope: 'https://converge.cv/', pushManager, unregister: vi.fn(async () => true) };
  let recoverySubscription: unknown = null;
  const recoveryPushManager = {
    subscribe: vi.fn(async (...args: Parameters<typeof pushManager.subscribe>) => {
      const created = await pushManager.subscribe(...args);
      recoverySubscription = created;
      return created;
    }),
    getSubscription: vi.fn(async () => recoverySubscription),
  };
  const recoveryRegistration = {
    scope: 'https://converge.cv/__converge-push/test-key/',
    pushManager: recoveryPushManager,
    unregister: vi.fn(async () => true),
  };
  let recoveryRegistered = false;
  let rootLookupCount = 0;
  const navigatorMock = {
    userAgent: 'vitest',
    serviceWorker: {
      ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration),
      register: vi.fn(async (_script: string, options?: RegistrationOptions) => {
        if (options?.scope?.startsWith('/__converge-push/')) {
          recoveryRegistered = true;
          recoveryRegistration.scope = `https://converge.cv${options.scope}`;
          return recoveryRegistration;
        }
        return registration;
      }),
      getRegistration: vi.fn(async (scope?: string) => {
        if (scope?.startsWith('/__converge-push/')) {
          return recoveryRegistered ? recoveryRegistration : registration;
        }
        if ((scope === '/' || scope === undefined) && rootLookupCount++ === 0) return null;
        return registration;
      }),
      getRegistrations: vi.fn(async () => [
        registration,
        ...(recoveryRegistered ? [recoveryRegistration] : []),
      ]),
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

  return {
    navigatorMock,
    pushManager,
    registration,
    recoveryPushManager,
    recoveryRegistration,
  };
}

describe('push helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as any).PushManager;
  });

  it('normalizes XMTP HMAC key maps for vapid.party', () => {
    const normalized = normalizeXmtpHmacKeys(
      new Map([
        [
          GROUP_ID_A.toUpperCase(),
          [
            {
              key: new Uint8Array([1, 2, 3]),
              epoch: 7n,
            },
            {
              key: new Uint8Array([4, 5, 6]),
              epoch: 8n,
            },
          ],
        ],
        [GROUP_TOPIC_B.toUpperCase(), [{ key: new Uint8Array([9]), epoch: 9n }]],
        ['/xmtp/mls/1/not-a-group-topic', [{ key: new Uint8Array([10]), epoch: 10n }]],
      ]),
    );

    expect(normalized).toEqual([
      {
        topic: GROUP_TOPIC_A,
        hmacKeys: [
          { epoch: '7', key: 'AQID' },
          { epoch: '8', key: 'BAUG' },
        ],
      },
      {
        topic: GROUP_TOPIC_B,
        hmacKeys: [{ epoch: '9', key: 'CQ' }],
      },
    ]);
  });

  it('accepts only canonicalizable MLS group topics and appends the installation welcome topic', () => {
    expect(normalizeXmtpGroupTopic(GROUP_ID_A.toUpperCase())).toBe(GROUP_TOPIC_A);
    expect(normalizeXmtpGroupTopic(GROUP_TOPIC_A.toUpperCase())).toBe(GROUP_TOPIC_A);
    expect(normalizeXmtpGroupTopic('/xmtp/mls/1/g-short/proto')).toBeNull();
    expect(normalizeXmtpGroupTopic('a'.repeat(64))).toBeNull();
    expect(normalizeXmtpGroupTopic(`/xmtp/mls/1/g-${'a'.repeat(64)}/proto`)).toBeNull();
    expect(normalizeXmtpGroupTopic(`/xmtp/mls/1/w-${INSTALLATION_ID_A}/proto`)).toBeNull();

    expect(normalizeXmtpPushTopics(topics, INSTALLATION_ID_A)).toEqual([
      ...topics,
      {
        topic: `/xmtp/mls/1/w-${INSTALLATION_ID_A}/proto`,
        hmacKeys: [],
      },
    ]);
    expect(() => normalizeXmtpPushTopics(topics, 'installation-1')).toThrow(/32-byte/i);
  });

  it('waits for bootstrap sync before refreshing the active inbox topic snapshot', () => {
    expect(
      isPushRegistrationRefreshReady({
        connectionStatus: 'connected',
        syncStatus: 'idle',
        lastConnected: 200,
        lastSyncedAt: 100,
      }),
    ).toBe(false);
    expect(
      isPushRegistrationRefreshReady({
        connectionStatus: 'connected',
        syncStatus: 'complete',
        lastConnected: 200,
        lastSyncedAt: 100,
      }),
    ).toBe(true);
    expect(
      isPushRegistrationRefreshReady({
        connectionStatus: 'connected',
        syncStatus: 'idle',
        lastConnected: 200,
        lastSyncedAt: 201,
      }),
    ).toBe(true);
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

    expect(payload.identity).toEqual({
      inboxId: identity.inboxId,
      installationId: identity.installationId,
    });
    expect(payload.app.id).toBe('converge.cv');
    expect(payload.preferences).toEqual({
      minimalPayloadOnly: true,
      plaintextPreview: false,
    });
    expect(payload.xmtp.topics).toEqual(topics);
    expect(payload.notification.inboxHandle).toBe('legacy-current-inbox');
    expect(JSON.stringify(payload)).not.toMatch(/messageBody|previewText|body/);
    expect(payload.identity).not.toHaveProperty('address');
    expect(JSON.stringify(payload)).not.toMatch(/fcm|apns|pushProvider/i);
  });

  it('keeps XMTP alert registration app-scoped while Web Push remains the delivery adapter', () => {
    const registration = buildXmtpAlertRegistrationPayload({
      appOrigin: 'https://converge.cv',
      identity,
      subscription: {
        endpoint: 'https://push.example/subscription',
        expirationTime: null,
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      topics,
      inboxHandle: 'opaque-app-handle',
      registeredAt: '2026-07-14T00:00:00.000Z',
    });
    const unregistration = buildXmtpAlertUnregistrationPayload({
      appOrigin: 'https://converge.cv',
      endpoint: registration.subscription.endpoint,
      identity,
      deletedAt: '2026-07-14T01:00:00.000Z',
    });

    expect(registration.app).toEqual({ id: 'converge.cv', origin: 'https://converge.cv' });
    expect(unregistration.app).toEqual(registration.app);
    expect(unregistration.identity).toEqual({
      inboxId: identity.inboxId,
      installationId: identity.installationId,
    });
  });

  it('reports end-to-end XMTP delivery ready only from explicit public health', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: 'healthy',
        xmtp: {
          deliveryReady: true,
          listener: {
            configured: true,
            status: 'ready',
            lastCheckedAt: '2026-07-14T00:00:00.000Z',
          },
          bridge: {
            status: 'synced',
            pendingRegistrationCount: 0,
            failedRegistrationCount: 0,
            lastSuccessfulSyncAt: '2026-07-14T00:00:01.000Z',
          },
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;

    await expect(getXmtpPushServiceStatus({
      apiBase: 'https://relay.example/api',
      fetchFn: fetchFn as unknown as typeof fetch,
    })).resolves.toMatchObject({
      relayReachable: true,
      relayStatus: 'healthy',
      deliveryReadiness: 'ready',
      listenerStatus: 'ready',
      listenerLastCheckedAt: '2026-07-14T00:00:00.000Z',
      bridgeStatus: 'synced',
      bridgeLastSuccessfulSyncAt: '2026-07-14T00:00:01.000Z',
      pendingRegistrationCount: 0,
      failedRegistrationCount: 0,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://relay.example/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not infer XMTP delivery readiness from a healthy relay alone', async () => {
    const genericHealth = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: 'healthy', runtime: 'cloudflare-worker' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;
    const degradedHealth = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: 'healthy',
        xmtp: {
          deliveryReady: false,
          bridge: { pendingRegistrationCount: 2, failedRegistrationCount: 1 },
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;
    const inconsistentHealth = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: 'healthy', xmtp: { deliveryReady: true } },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;

    await expect(getXmtpPushServiceStatus({
      fetchFn: genericHealth as unknown as typeof fetch,
    })).resolves.toMatchObject({
      relayReachable: true,
      deliveryReadiness: 'unknown',
    });
    await expect(getXmtpPushServiceStatus({
      fetchFn: degradedHealth as unknown as typeof fetch,
    })).resolves.toMatchObject({
      relayReachable: true,
      deliveryReadiness: 'degraded',
      pendingRegistrationCount: 2,
      failedRegistrationCount: 1,
    });
    await expect(getXmtpPushServiceStatus({
      fetchFn: inconsistentHealth as unknown as typeof fetch,
    })).resolves.toMatchObject({
      relayReachable: true,
      deliveryReadiness: 'degraded',
    });
  });

  it('reports an explicitly unconfigured listener without treating the relay as down', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: 'healthy',
        xmtp: {
          deliveryReady: false,
          listener: { configured: false, status: 'not_configured' },
          bridge: {
            status: 'not_configured',
            pendingRegistrationCount: 0,
            failedRegistrationCount: 0,
          },
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;

    await expect(getXmtpPushServiceStatus({
      fetchFn: fetchFn as unknown as typeof fetch,
    })).resolves.toMatchObject({
      relayReachable: true,
      deliveryReadiness: 'not-configured',
      listenerStatus: 'not_configured',
      bridgeStatus: 'not_configured',
    });
  });

  it('fails closed when the public relay health check is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network unavailable');
    }) as unknown as Mock;

    await expect(getXmtpPushServiceStatus({
      fetchFn: fetchFn as unknown as typeof fetch,
      requestTimeoutMs: 10,
    })).resolves.toMatchObject({
      relayReachable: false,
      deliveryReadiness: 'unavailable',
    });
  });

  it('uses one browser subscription and upserts active plus cached inactive inboxes', async () => {
    const stateStore = new MemoryPushStateStore();
    const inactiveIdentity: XmtpPushIdentity = {
      inboxId: 'inbox-2',
      installationId: INSTALLATION_ID_B,
    };
    await cacheInboxPushRegistration(
      {
        identity: inactiveIdentity,
        topics: [{ topic: GROUP_TOPIC_B, hmacKeys: [{ epoch: '2', key: 'inactive-key' }] }],
        displayName: 'Blue Heron',
        inboxHandle: 'opaque-inbox-two',
      },
      { stateStore, now: 10 },
    );

    const subscription = createSubscription();
    const { pushManager } = installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async () => registrationResponse(201)) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [
        {
          identity,
          topics,
          displayName: 'Orange Orca',
          inboxHandle: 'opaque-inbox-one',
        },
      ],
      {
        loadedInboxIds: ['inbox-1', 'inbox-2'],
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result).toMatchObject({ success: true, registeredInboxCount: 2, topicCount: 4 });
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const posts = fetchFn.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(posts).toHaveLength(2);
    const payloads = posts.map((call) => JSON.parse(String(call[1]?.body)));
    expect(payloads.map((payload) => payload.identity.inboxId).sort()).toEqual(['inbox-1', 'inbox-2']);
    expect(payloads.find((payload) => payload.identity.inboxId === 'inbox-1')?.notification).toEqual({
      inboxHandle: 'opaque-inbox-one',
    });
    expect(payloads.find((payload) => payload.identity.inboxId === 'inbox-2')?.notification).toEqual({
      inboxHandle: 'opaque-inbox-two',
    });
    expect((await stateStore.getPreferences()).enabled).toBe(true);
  });

  it('requires app preference and matching inbox records instead of trusting an endpoint alone', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-status-handle' },
      { stateStore },
    );
    await stateStore.putRegistration({ ...cached, endpoint: subscription.endpoint });

    const endpointOnly = await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore });
    expect(endpointOnly.state).toBe('disabled');
    expect(endpointOnly.hasBrowserSubscription).toBe(true);

    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const enabled = await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore });
    expect(enabled).toMatchObject({ state: 'enabled', registeredInboxCount: 1, expectedInboxCount: 1 });

    const partial = await getAppPushStatus({ loadedInboxIds: ['inbox-1', 'inbox-2'], stateStore });
    expect(partial.state).toBe('partial');
    expect(partial.missingInboxIds).toEqual(['inbox-2']);
  });

  it('deletes every cached inbox registration before unsubscribing the shared endpoint', async () => {
    const stateStore = new MemoryPushStateStore();
    const events: string[] = [];
    const subscription = createSubscription('https://push.example/shared');
    subscription.unsubscribe.mockImplementation(async () => {
      events.push('unsubscribe');
      return true;
    });
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);

    const secondIdentity = { inboxId: 'inbox-2', installationId: INSTALLATION_ID_B };
    for (const [currentIdentity, handle] of [
      [identity, 'opaque-delete-one'],
      [secondIdentity, 'opaque-delete-two'],
    ] as const) {
      const cached = await cacheInboxPushRegistration(
        { identity: currentIdentity, topics, inboxHandle: handle },
        { stateStore },
      );
      await stateStore.putRegistration({ ...cached, endpoint: subscription.endpoint });
    }
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      events.push(`delete:${body.identity.inboxId}`);
      return registrationResponse();
    }) as unknown as Mock;

    const disabled = await disablePush({
      identity,
      stateStore,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(disabled).toBe(true);
    expect(events).toEqual(['delete:inbox-1', 'delete:inbox-2', 'unsubscribe']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await stateStore.listRegistrations()).toEqual([]);
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('disables every Converge subscription without touching unrelated worker state', async () => {
    const stateStore = new MemoryPushStateStore();
    const rootSubscription = createSubscription('https://push.example/root');
    const recoverySubscription = createSubscription('https://push.example/recovery');
    const {
      navigatorMock,
      registration,
      recoveryPushManager,
      recoveryRegistration,
    } = installPushBrowserMocks({
      subscription: recoverySubscription,
      existingSubscription: rootSubscription,
    });
    await navigatorMock.serviceWorker.register('/sw.js', {
      scope: '/__converge-push/current-key/',
      updateViaCache: 'none',
    });
    await recoveryPushManager.subscribe();

    const unrelatedSubscription = createSubscription('https://push.example/unrelated');
    const unrelatedRegistration = {
      scope: 'https://converge.cv/unrelated-app/',
      pushManager: { getSubscription: vi.fn(async () => unrelatedSubscription) },
      unregister: vi.fn(async () => true),
    };
    (navigatorMock.serviceWorker.getRegistrations as Mock).mockResolvedValue([
      registration,
      recoveryRegistration,
      unrelatedRegistration,
    ]);

    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-disable-all' },
      { stateStore },
    );
    await stateStore.putRegistration({ ...cached, endpoint: recoverySubscription.endpoint });
    await stateStore.setPreferences({
      enabled: true,
      endpoint: recoverySubscription.endpoint,
      updatedAt: 1,
    });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    expect(
      await disablePush({
        identity,
        stateStore,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).toBe(true);

    expect(rootSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(recoverySubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(recoveryRegistration.unregister).toHaveBeenCalledTimes(1);
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(unrelatedSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(unrelatedRegistration.unregister).not.toHaveBeenCalled();
  });

  it('surfaces failed relay deletion and retries the retained tombstone', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);

    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-delete-retry' },
      { stateStore },
    );
    await stateStore.putRegistration({ ...cached, endpoint: subscription.endpoint });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });

    const failedFetch = vi.fn(async () => new Response('{}', { status: 503 })) as unknown as Mock;
    expect(
      await disablePush({ stateStore, fetchFn: failedFetch as unknown as typeof fetch })
    ).toBe(false);
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({ pendingDeletion: true }),
    ]);
    expect(await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore })).toMatchObject({
      state: 'partial',
      enabledPreference: false,
      pendingDeletionCount: 1,
    });

    const retryFetch = vi.fn(async () => registrationResponse()) as unknown as Mock;
    expect(
      await disablePush({ stateStore, fetchFn: retryFetch as unknown as typeof fetch })
    ).toBe(true);
    expect(await stateStore.listRegistrations()).toEqual([]);
    expect(await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore })).toMatchObject({
      state: 'disabled',
      pendingDeletionCount: 0,
    });
  });

  it('keeps a stable opaque handle across installation changes and maps activity back locally', async () => {
    const stateStore = new MemoryPushStateStore();
    const first = await cacheInboxPushRegistration(
      { identity, topics, displayName: 'Orange Orca', inboxHandle: 'opaque-stable-handle' },
      { stateStore, now: 1 },
    );
    const nextIdentity = { ...identity, installationId: INSTALLATION_ID_NEW };
    const second = await cacheInboxPushRegistration(
      { identity: nextIdentity, topics, displayName: 'Orange Orca' },
      { stateStore, now: 2 },
    );
    expect(first.inboxHandle).toBe('opaque-stable-handle');
    expect(second.inboxHandle).toBe(first.inboxHandle);
    expect(second.key).toBe(pushRegistrationKey(nextIdentity));

    await stateStore.putActivity({ inboxHandle: first.inboxHandle, receivedAt: 50, count: 2 });
    expect(await listPendingPushActivity(stateStore)).toEqual([
      {
        inboxHandle: 'opaque-stable-handle',
        inboxId: 'inbox-1',
        displayName: 'Orange Orca',
        receivedAt: 50,
        count: 2,
      },
    ]);
    const cleared = vi.fn();
    const stopListening = listenForPushActivityCleared(cleared);
    await clearPushActivityForInbox('INBOX-1', stateStore);
    expect(await stateStore.listActivity()).toEqual([]);
    expect(cleared).toHaveBeenCalledWith('inbox-1');
    stopListening();
  });

  it('does not accept the public inbox id itself as an opaque notification handle', async () => {
    const stateStore = new MemoryPushStateStore();
    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: identity.inboxId },
      { stateStore },
    );
    expect(cached.inboxHandle).not.toBe(identity.inboxId);
    expect(cached.inboxHandle).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('updates the service-worker-visible inbox name without reconnecting XMTP', async () => {
    const stateStore = new MemoryPushStateStore();
    const cached = await cacheInboxPushRegistration(
      { identity, topics, displayName: 'Orange Orca', inboxHandle: 'opaque-profile-handle' },
      { stateStore, now: 1 },
    );
    await stateStore.putActivity({ inboxHandle: cached.inboxHandle, receivedAt: 5, count: 1 });

    expect(await updatePushInboxProfile('INBOX-1', 'Green Falcon', stateStore)).toBe(true);
    expect(await listPendingPushActivity(stateStore)).toEqual([
      expect.objectContaining({ inboxId: 'inbox-1', displayName: 'Green Falcon' }),
    ]);
  });

  it('replaces a superseded installation relay record after refreshing an inbox', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const oldIdentity = { ...identity, installationId: INSTALLATION_ID_OLD };
    const oldRegistration = await cacheInboxPushRegistration(
      { identity: oldIdentity, topics, inboxHandle: 'opaque-replaced-handle' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({ ...oldRegistration, endpoint: subscription.endpoint });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      return registrationResponse();
    }) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result.success).toBe(true);
    expect(methods).toEqual(['POST', 'DELETE']);
    const registrations = await stateStore.listRegistrations();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.identity.installationId).toBe(INSTALLATION_ID_A);
    expect(registrations[0]?.inboxHandle).toBe('opaque-replaced-handle');
  });

  it('authorizes an atomic browser endpoint replacement without deleting the rotated route', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/current');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-endpoint-rotation' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({
      ...cached,
      endpoint: 'https://push.example/replaced',
      relayDiagnostics: {
        receipt: 'r'.repeat(43),
        statusPath: '/api/xmtp/status',
        testPath: '/api/xmtp/status/test',
      },
    });
    await stateStore.setPreferences({ enabled: true, endpoint: cached.endpoint, updatedAt: 1 });
    const requests: Array<{
      method: string;
      headers: Headers;
      body: Record<string, unknown>;
    }> = [];
    const nextReceipt = 'n'.repeat(43);
    const fetchFn = vi.fn(async (_url, init) => {
      requests.push({
        method: String(init?.method),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        success: true,
        data: {
          diagnostics: {
            receipt: nextReceipt,
            statusPath: '/api/xmtp/status',
            testPath: '/api/xmtp/status/test',
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result.success).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['POST']);
    expect(requests[0]?.headers.get('Authorization')).toBe(`Bearer ${'r'.repeat(43)}`);
    expect(requests[0]?.headers.get('X-Vapid-Party-Diagnostics')).toBe('1');
    expect(JSON.stringify(requests[0]?.body)).not.toContain('r'.repeat(43));
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({
        endpoint: subscription.endpoint,
        pendingDeletion: false,
        relayDiagnostics: expect.objectContaining({ receipt: nextReceipt }),
      }),
    ]);
  });

  it('rejects a successful refresh response without a management capability', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/exact-refresh');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const receipt = 'p'.repeat(43);
    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-exact-refresh' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({
      ...cached,
      endpoint: subscription.endpoint,
      relayDiagnostics: {
        receipt,
        statusPath: '/api/xmtp/status',
        testPath: '/api/xmtp/status/test',
      },
    });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { subscriptionId: 'existing-registration' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not return a management capability');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await stateStore.listRegistrations())[0]?.relayDiagnostics?.receipt).toBe(receipt);
  });

  it('does not retry a relay capability conflict without authorization', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/conflict');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const receipt = 'c'.repeat(43);
    const cached = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-capability-conflict' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({
      ...cached,
      endpoint: subscription.endpoint,
      relayDiagnostics: {
        receipt,
        statusPath: '/api/xmtp/status',
        testPath: '/api/xmtp/status/test',
      },
    });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const fetchFn = vi.fn(async () => new Response('management capability conflict', { status: 409 })) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('409');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchFn.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      `Bearer ${receipt}`,
    );
  });

  it('removes the legacy browser endpoint after the last inbox refresh completes migration', async () => {
    const stateStore = new MemoryPushStateStore();
    const rootSubscription = createSubscription('https://push.example/legacy-root');
    const recoverySubscription = createSubscription('https://push.example/current-recovery');
    const {
      navigatorMock,
      registration,
      recoveryPushManager,
      recoveryRegistration,
    } = installPushBrowserMocks({
      subscription: recoverySubscription,
      existingSubscription: rootSubscription,
    });
    await navigatorMock.serviceWorker.register('/sw.js', {
      scope: '/__converge-push/current-key/',
      updateViaCache: 'none',
    });
    await recoveryPushManager.subscribe();
    (navigatorMock.serviceWorker.getRegistrations as Mock).mockResolvedValue([
      registration,
      recoveryRegistration,
    ]);

    const migrating = await cacheInboxPushRegistration(
      { identity, topics, inboxHandle: 'opaque-migrating-inbox' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({ ...migrating, endpoint: rootSubscription.endpoint });
    const migratedIdentity = { inboxId: 'inbox-2', installationId: INSTALLATION_ID_B };
    const migrated = await cacheInboxPushRegistration(
      { identity: migratedIdentity, topics, inboxHandle: 'opaque-migrated-inbox' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({ ...migrated, endpoint: recoverySubscription.endpoint });
    await stateStore.setPreferences({
      enabled: true,
      endpoint: recoverySubscription.endpoint,
      updatedAt: 1,
    });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      return registrationResponse();
    }) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result).toMatchObject({ success: true, endpoint: recoverySubscription.endpoint });
    expect(methods).toEqual(['POST']);
    expect(rootSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(recoverySubscription.unsubscribe).not.toHaveBeenCalled();
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(recoveryRegistration.unregister).not.toHaveBeenCalled();
  });

  it('coalesces concurrent refreshes for the same inbox installation', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let finishRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    const fetchFn = vi.fn(async () => {
      await requestGate;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;
    const input = { identity, topics, displayName: 'Orange Orca' };
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };

    const first = refreshPushRegistrationForInbox(input, options);
    const second = refreshPushRegistrationForInbox(input, options);
    expect(second).toBe(first);
    finishRequest?.();
    await Promise.all([first, second]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('runs one trailing refresh with the newest HMAC snapshot', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let startFirstRequest: (() => void) | undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      startFirstRequest = resolve;
    });
    let finishFirstRequest: (() => void) | undefined;
    const firstRequestGate = new Promise<void>((resolve) => {
      finishFirstRequest = resolve;
    });
    const postedBodies: Array<Record<string, any>> = [];
    const fetchFn = vi.fn(async (_url, init) => {
      postedBodies.push(JSON.parse(String(init?.body)));
      if (postedBodies.length === 1) {
        startFirstRequest?.();
        await firstRequestGate;
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };
    const newerTopics = [{
      topic: GROUP_TOPIC_A,
      hmacKeys: [{ epoch: '2', key: 'newest-key' }],
    }];

    const first = refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      options,
    );
    await firstRequestStarted;
    const second = refreshPushRegistrationForInbox(
      { identity, topics: newerTopics, displayName: 'Orange Orca' },
      options,
    );
    expect(second).toBe(first);
    finishFirstRequest?.();
    await first;

    expect(postedBodies).toHaveLength(2);
    expect(postedBodies[1]?.xmtp.topics).toContainEqual({
      topic: GROUP_TOPIC_A,
      hmacKeys: [{ epoch: '2', key: 'newest-key' }],
    });
  });

  it('serializes Disable behind an in-flight refresh and leaves push disabled', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let startPost: (() => void) | undefined;
    const postStarted = new Promise<void>((resolve) => {
      startPost = resolve;
    });
    let finishPost: (() => void) | undefined;
    const postGate = new Promise<void>((resolve) => {
      finishPost = resolve;
    });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === 'POST') {
        startPost?.();
        await postGate;
      }
      return registrationResponse();
    }) as unknown as Mock;
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };

    const refresh = refreshPushRegistrationForInbox({ identity, topics }, options);
    await postStarted;
    const disable = disablePush({ identity, ...options });
    finishPost?.();
    await Promise.all([refresh, disable]);

    expect(methods).toEqual(['POST', 'DELETE']);
    expect(await stateStore.listRegistrations()).toEqual([]);
    expect((await stateStore.getPreferences()).enabled).toBe(false);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cancels a trailing refresh when Burn removes the inbox', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let startPost: (() => void) | undefined;
    const postStarted = new Promise<void>((resolve) => {
      startPost = resolve;
    });
    let finishPost: (() => void) | undefined;
    const postGate = new Promise<void>((resolve) => {
      finishPost = resolve;
    });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === 'POST') {
        startPost?.();
        await postGate;
      }
      return registrationResponse();
    }) as unknown as Mock;
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };

    const first = refreshPushRegistrationForInbox({ identity, topics }, options);
    await postStarted;
    const trailing = refreshPushRegistrationForInbox(
      {
        identity,
        topics: [{ topic: GROUP_TOPIC_A, hmacKeys: [{ epoch: '2', key: 'new-key' }] }],
      },
      options,
    );
    const remove = removePushRegistrationForInbox(identity.inboxId, options);
    finishPost?.();
    const [, trailingResult, removed] = await Promise.all([first, trailing, remove]);

    expect(removed).toBe(true);
    expect(trailingResult.success).toBe(false);
    expect(methods).toEqual(['POST', 'DELETE']);
    expect(await stateStore.listRegistrations()).toEqual([]);
    expect(await stateStore.getProfileByInboxId(identity.inboxId)).toBeUndefined();
    expect((await stateStore.getPreferences()).enabled).toBe(true);
  });

  it('bounds a stalled refresh so Burn can finish local push cleanup', async () => {
    const timeoutIdentity = { ...identity, installationId: INSTALLATION_ID_NEW };
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let startPost: (() => void) | undefined;
    const postStarted = new Promise<void>((resolve) => {
      startPost = resolve;
    });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === 'POST') {
        startPost?.();
        return new Promise<Response>(() => undefined);
      }
      return registrationResponse();
    }) as unknown as Mock;
    const options = {
      stateStore,
      fetchFn: fetchFn as unknown as typeof fetch,
      requestTimeoutMs: 5_000,
    };

    const refresh = refreshPushRegistrationForInbox({ identity: timeoutIdentity, topics }, options);
    await postStarted;
    const startedAt = Date.now();
    const removed = await removePushRegistrationForInbox(timeoutIdentity.inboxId, options);
    const refreshResult = await refresh;

    expect(refreshResult.success).toBe(false);
    expect(removed).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(methods).toEqual(['POST', 'DELETE']);
    expect(await stateStore.listRegistrations()).toEqual([]);
  });

  it('lets a later Disable supersede an Enable already waiting for the mutation lock', async () => {
    const orderedIdentity = { ...identity, installationId: INSTALLATION_ID_B };
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration, pushManager } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    let startRefresh: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      startRefresh = resolve;
    });
    let finishRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === 'POST') {
        startRefresh?.();
        await refreshGate;
      }
      return registrationResponse();
    }) as unknown as Mock;
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };

    const refresh = refreshPushRegistrationForInbox({ identity: orderedIdentity, topics }, options);
    await refreshStarted;
    const enable = enablePushForLoadedInboxes(
      [{ identity: orderedIdentity, topics }],
      { ...options, vapidPublicKey: TEST_VAPID_PUBLIC_KEY },
    );
    const disable = disablePush({ identity: orderedIdentity, ...options });
    finishRefresh?.();
    const [, enableResult, disabled] = await Promise.all([refresh, enable, disable]);

    expect(enableResult.success).toBe(false);
    expect(disabled).toBe(true);
    expect(methods).toEqual(['POST', 'DELETE']);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('does not let a pending permission/subscription promise block Burn', async () => {
    const stateStore = new MemoryPushStateStore();
    const pendingIdentity = { ...identity, installationId: '5'.repeat(64) };
    const existingSubscription = createSubscription('https://push.example/existing');
    const pendingSubscription = createSubscription('https://push.example/pending');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription: existingSubscription,
      existingSubscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const cached = await cacheInboxPushRegistration(
      { identity: pendingIdentity, topics, inboxHandle: 'opaque-pending-permission' },
      { stateStore },
    );
    await stateStore.putRegistration({ ...cached, endpoint: existingSubscription.endpoint });
    await stateStore.setPreferences({ enabled: true, endpoint: existingSubscription.endpoint, updatedAt: 1 });
    let resolveBrowserSubscription: ((value: {
      subscription: ReturnType<typeof createSubscription>;
      created: boolean;
    }) => void) | undefined;
    const browserSubscriptionPromise = new Promise<{
      subscription: ReturnType<typeof createSubscription>;
      created: boolean;
    }>((resolve) => {
      resolveBrowserSubscription = resolve;
    });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;
    const options = { stateStore, fetchFn: fetchFn as unknown as typeof fetch };

    const enable = enablePushForLoadedInboxes(
      [{ identity: pendingIdentity, topics }],
      {
        ...options,
        browserSubscriptionPromise: browserSubscriptionPromise as Promise<any>,
      },
    );
    const removed = await removePushRegistrationForInbox(pendingIdentity.inboxId, options);
    expect(removed).toBe(true);
    resolveBrowserSubscription?.({ subscription: pendingSubscription, created: true });
    const enableResult = await enable;

    expect(enableResult.success).toBe(false);
    expect(pendingSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await stateStore.listRegistrations()).toEqual([]);
  });

  it('removes one burned inbox without disabling the shared browser subscription', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/shared');
    const { navigatorMock, registration } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const secondIdentity = { inboxId: 'inbox-2', installationId: INSTALLATION_ID_B };
    for (const [currentIdentity, handle] of [
      [identity, 'opaque-burn-one'],
      [secondIdentity, 'opaque-burn-two'],
    ] as const) {
      const cached = await cacheInboxPushRegistration(
        { identity: currentIdentity, topics, inboxHandle: handle },
        { stateStore },
      );
      await stateStore.putRegistration({ ...cached, endpoint: subscription.endpoint });
    }
    await stateStore.putActivity({ inboxHandle: 'opaque-burn-one', receivedAt: 10, count: 1 });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const removed = await removePushRegistrationForInbox('INBOX-1', {
      stateStore,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(removed).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)).identity.inboxId).toBe('inbox-1');
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect((await stateStore.getPreferences()).enabled).toBe(true);
    expect((await stateStore.listRegistrations()).map((entry) => entry.identity.inboxId)).toEqual(['inbox-2']);
    expect(await stateStore.getProfileByInboxId('inbox-1')).toBeUndefined();
    expect(await stateStore.listActivity()).toEqual([]);
  });

  it('enables push by subscribing and posting the XMTP registration to vapid.party without an API key', async () => {
    const subscription = createSubscription();
    const stateStore = new MemoryPushStateStore();
    const { navigatorMock, pushManager } = installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async (_url, _init) =>
      new Response(JSON.stringify({
        success: true,
        data: {
          subscriptionId: 'registration-1',
          diagnostics: {
            receipt: 'r'.repeat(43),
            statusPath: '/api/xmtp/status',
            testPath: '/api/xmtp/status/test',
          },
        },
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as Mock;

    const enablePromise = enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as unknown as typeof fetch,
      stateStore,
    });
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    const result = await enablePromise;

    expect(result).toMatchObject({
      success: true,
      endpoint: subscription.endpoint,
      registrationId: 'registration-1',
      topicCount: 2,
    });
    expect(navigatorMock.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    expect(pushManager.subscribe).toHaveBeenCalled();

    const lastCall = fetchFn.mock.calls[fetchFn.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe('https://vapid.party/api/xmtp/subscriptions');
    const registrationHeaders = new Headers(lastCall?.[1]?.headers);
    expect(registrationHeaders.get('Content-Type')).toBe('application/json');
    expect(registrationHeaders.get('X-Vapid-Party-Diagnostics')).toBe('1');
    expect(JSON.stringify(lastCall?.[1]?.headers)).not.toMatch(/X-API-Key/i);
    const body = JSON.parse(String(lastCall?.[1]?.body));
    expect(body.identity).toEqual({
      inboxId: identity.inboxId,
      installationId: identity.installationId,
    });
    expect(body.xmtp.topics).toEqual(normalizeXmtpPushTopics(topics, identity.installationId));
    expect((await stateStore.listRegistrations())[0]?.relayDiagnostics).toEqual({
      receipt: 'r'.repeat(43),
      statusPath: '/api/xmtp/status',
      testPath: '/api/xmtp/status/test',
    });

    await disablePush({
      identity,
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as unknown as typeof fetch,
      stateStore,
    });
    const disableCall = fetchFn.mock.calls[fetchFn.mock.calls.length - 1];
    expect(disableCall?.[1]?.method).toBe('DELETE');
    expect(new Headers(disableCall?.[1]?.headers).get('Authorization')).toBe(
      `Bearer ${'r'.repeat(43)}`,
    );
    expect(String(disableCall?.[1]?.body)).not.toContain('r'.repeat(43));
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('reuses an existing subscription when present', async () => {
    const subscription = createSubscription('https://push.example/existing');
    const { pushManager } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).toHaveBeenCalled();
  });

  it('removes an empty superseded recovery scope after root enable succeeds', async () => {
    const subscription = createSubscription('https://push.example/root-current');
    const {
      navigatorMock,
      registration,
      recoveryRegistration,
    } = installPushBrowserMocks({
      subscription,
      existingSubscription: subscription,
    });
    (navigatorMock.serviceWorker.getRegistrations as Mock).mockResolvedValue([
      registration,
      recoveryRegistration,
    ]);
    (recoveryRegistration.pushManager.getSubscription as Mock).mockResolvedValue(null);
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ success: true, endpoint: subscription.endpoint });
    expect(recoveryRegistration.unregister).toHaveBeenCalledTimes(1);
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('ignores a preferred endpoint owned by an unrelated service worker scope', async () => {
    const subscription = createSubscription('https://push.example/unrelated');
    const { navigatorMock, registration, pushManager } = installPushBrowserMocks({ subscription });
    (pushManager.getSubscription as Mock).mockReset().mockResolvedValue(null);
    const unrelated = {
      scope: 'https://converge.cv/unrelated-app/',
      pushManager: { getSubscription: vi.fn(async () => subscription) },
    };
    (navigatorMock.serviceWorker.getRegistrations as Mock)
      .mockResolvedValue([unrelated, registration]);

    const state = await getBrowserPushSubscriptionState(subscription.endpoint);

    expect(state.subscription).toBeNull();
    expect(state.registration).toBe(registration);
  });

  it('replaces an existing subscription bound to a stale VAPID key', async () => {
    const current = createSubscription('https://push.example/current');
    const stale = createSubscription(
      'https://push.example/stale',
      new Uint8Array(65).fill(9),
    );
    const { pushManager } = installPushBrowserMocks({
      subscription: current,
      existingSubscription: stale,
    });
    const stateStore = new MemoryPushStateStore();
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForCurrentUser({
      identity,
      topics,
      stateStore,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ success: true, endpoint: current.endpoint });
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('waits for the exact root service worker registration to activate before subscribing', async () => {
    const subscription = createSubscription('https://push.example/ready');
    const { navigatorMock, registration, pushManager } = installPushBrowserMocks({ subscription });
    const listeners = new Set<() => void>();
    const worker = {
      state: 'installing' as ServiceWorkerState,
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as () => void);
      },
      removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as () => void);
      },
    };
    Object.assign(registration, { installing: worker, waiting: null, active: null });
    (navigatorMock.serviceWorker.getRegistration as Mock)
      .mockReset()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const enable = enablePushForLoadedInboxes(
      [{ identity, topics }],
      { vapidPublicKey: TEST_VAPID_PUBLIC_KEY, fetchFn: fetchFn as unknown as typeof fetch },
    );
    await vi.waitFor(() => expect(navigatorMock.serviceWorker.getRegistration).toHaveBeenCalledWith('/'));
    expect(navigatorMock.serviceWorker.register).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();

    worker.state = 'activated';
    listeners.forEach((listener) => listener());
    expect((await enable).success).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects a decoded VAPID key that is not an uncompressed P-256 public key', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription();
    const { pushManager } = installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: `A${TEST_VAPID_PUBLIC_KEY.slice(1)}`,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/65-byte uncompressed P-256 key/i);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('recovers when the browser finishes creating a subscription after subscribe rejects', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/late-success');
    const { pushManager } = installPushBrowserMocks({ subscription });
    (pushManager.getSubscription as Mock)
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(subscription);
    pushManager.subscribe.mockRejectedValueOnce(
      new DOMException('Registration failed - push service error', 'AbortError'),
    );
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result).toMatchObject({ success: true, endpoint: subscription.endpoint });
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable provider error without posting registration data to vapid.party', async () => {
    vi.useFakeTimers();
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription();
    const { navigatorMock, pushManager } = installPushBrowserMocks({ subscription });
    (pushManager.getSubscription as Mock).mockReset().mockResolvedValue(null);
    pushManager.subscribe.mockRejectedValue(
      new DOMException('Registration failed - push service error', 'AbortError'),
    );
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const enable = enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );
    await vi.runAllTimersAsync();
    const result = await enable;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No subscription or inbox data was sent to vapid.party');
    expect(result.error).toMatch(/Web Push provider.*display permission.*push service.*retry/i);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(6);
    expect(navigatorMock.serviceWorker.register).toHaveBeenCalledWith(
      '/sw.js',
      expect.objectContaining({ scope: expect.stringMatching(/^\/__converge-push\//) }),
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('explains the Brave provider setting when new Web Push registrations are disabled', async () => {
    vi.useFakeTimers();
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription();
    const { navigatorMock, pushManager } = installPushBrowserMocks({ subscription });
    Object.assign(navigatorMock, { brave: { isBrave: vi.fn(async () => true) } });
    (pushManager.getSubscription as Mock).mockReset().mockResolvedValue(null);
    pushManager.subscribe.mockRejectedValue(
      new DOMException('Registration failed - push service error', 'AbortError'),
    );
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const enable = enablePushForLoadedInboxes(
      [{ identity, topics }],
      { stateStore, vapidPublicKey: TEST_VAPID_PUBLIC_KEY, fetchFn: fetchFn as unknown as typeof fetch },
    );
    await vi.runAllTimersAsync();
    const result = await enable;

    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/permission prompt only allowed converge\.cv to display notifications/i);
    expect(result.error).toContain('brave://settings/privacy');
    expect(result.error).toMatch(/verify Use Google services.*fully quit.*reopening Brave/i);
    expect(result.error).toMatch(/Other app or extension notifications do not prove/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('recovers a stuck root provider registration with a dedicated scope in the same enable attempt', async () => {
    vi.useFakeTimers();
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/retry-success');
    const { pushManager } = installPushBrowserMocks({ subscription });
    (pushManager.getSubscription as Mock).mockReset().mockResolvedValue(null);
    const providerError = new DOMException('Registration failed - push service error', 'AbortError');
    pushManager.subscribe
      .mockRejectedValueOnce(providerError)
      .mockRejectedValueOnce(providerError)
      .mockRejectedValueOnce(providerError)
      .mockResolvedValue(subscription);
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;
    const options = {
      stateStore,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    };

    const enable = enablePushForLoadedInboxes([{ identity, topics }], options);
    await vi.runAllTimersAsync();
    expect(await enable).toMatchObject({ success: true, endpoint: subscription.endpoint });
    expect(pushManager.subscribe).toHaveBeenCalledTimes(4);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await stateStore.getPreferences()).enabled).toBe(true);
  });

  it('removes an empty recovery worker after the root scope succeeds', async () => {
    const stateStore = new MemoryPushStateStore();
    const subscription = createSubscription('https://push.example/root-success');
    const { navigatorMock, registration, recoveryRegistration } = installPushBrowserMocks({ subscription });
    await navigatorMock.serviceWorker.register('/sw.js', {
      scope: '/__converge-push/abandoned-key/',
      updateViaCache: 'none',
    });
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result).toMatchObject({ success: true, endpoint: subscription.endpoint });
    expect(recoveryRegistration.unregister).toHaveBeenCalledTimes(1);
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it('shares one PushManager.subscribe call across concurrent enable attempts', async () => {
    const subscription = createSubscription('https://push.example/single-flight');
    const { pushManager } = installPushBrowserMocks({ subscription });
    let resolveSubscription: ((value: ReturnType<typeof createSubscription>) => void) | undefined;
    pushManager.subscribe.mockImplementation(
      () => new Promise((resolve) => { resolveSubscription = resolve; }),
    );
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;
    const options = {
      stateStore: new MemoryPushStateStore(),
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    };

    const first = enablePushForLoadedInboxes([{ identity, topics }], options);
    const second = enablePushForLoadedInboxes([{ identity, topics }], options);
    await vi.waitFor(() => expect(pushManager.subscribe).toHaveBeenCalledTimes(1));
    resolveSubscription?.(subscription);

    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps a stale-key subscription until its recovery-scope replacement is registered', async () => {
    vi.useFakeTimers();
    const current = createSubscription('https://push.example/replaced-after-provider-cleanup');
    const stale = createSubscription('https://push.example/stale-provider-key', new Uint8Array(65).fill(9));
    const { pushManager } = installPushBrowserMocks({ subscription: current, existingSubscription: stale });
    (pushManager.getSubscription as Mock)
      .mockReset()
      .mockResolvedValue(stale);
    pushManager.subscribe
      .mockRejectedValueOnce(new DOMException('Registration failed - push service error', 'AbortError'))
      .mockResolvedValueOnce(current);
    const fetchFn = vi.fn(async () => registrationResponse()) as unknown as Mock;

    const enable = enablePushForLoadedInboxes(
      [{ identity, topics }],
      { vapidPublicKey: TEST_VAPID_PUBLIC_KEY, fetchFn: fetchFn as unknown as typeof fetch },
    );
    await vi.runAllTimersAsync();
    const result = await enable;

    expect(result).toMatchObject({ success: true, endpoint: current.endpoint });
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(2);
    expect(stale.unsubscribe.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchFn.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('unsubscribes a newly created endpoint when local preparation fails', async () => {
    class RejectingPushStateStore extends MemoryPushStateStore {
      override async putRegistration(): Promise<void> {
        throw new Error('IndexedDB write failed');
      }
    }

    const stateStore = new RejectingPushStateStore();
    const subscription = createSubscription('https://push.example/orphan');
    installPushBrowserMocks({ subscription });

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      { stateStore, vapidPublicKey: TEST_VAPID_PUBLIC_KEY },
    );

    expect(result).toMatchObject({ success: false, error: 'IndexedDB write failed' });
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retains an active relay route and capability for retry when final persistence fails after POST', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class RejectingPersistedPushStateStore extends MemoryPushStateStore {
      private writes = 0;

      override async putRegistration(registration: Parameters<MemoryPushStateStore['putRegistration']>[0]): Promise<void> {
        this.writes += 1;
        if (this.writes === 2) throw new Error('IndexedDB persisted write failed');
        await super.putRegistration(registration);
      }
    }

    const stateStore = new RejectingPersistedPushStateStore();
    const subscription = createSubscription('https://push.example/recovery-pending');
    installPushBrowserMocks({ subscription });
    const methods: string[] = [];
    const requestHeaders: Headers[] = [];
    const receipt = 'b'.repeat(43);
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      requestHeaders.push(new Headers(init?.headers));
      return new Response(JSON.stringify({
        success: true,
        data: init?.method === 'POST' ? {
          diagnostics: {
            receipt,
            statusPath: '/api/xmtp/status',
            testPath: '/api/xmtp/status/test',
          },
        } : {},
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result.success).toBe(false);
    expect(methods).toEqual(['POST']);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({
        endpoint: subscription.endpoint,
        pendingRegistration: true,
        pendingDeletion: false,
        relayDiagnostics: expect.objectContaining({ receipt }),
      }),
    ]);
    expect((await stateStore.getPreferences()).enabled).toBe(true);
    expect(await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore })).toMatchObject({
      state: 'partial',
      enabledPreference: true,
      pendingRegistrationCount: 1,
      pendingDeletionCount: 0,
    });
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(identity.inboxId);

    const retry = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(retry.success).toBe(true);
    expect(methods).toEqual(['POST', 'POST']);
    expect(requestHeaders[1]?.get('Authorization')).toBe(`Bearer ${receipt}`);
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({
        endpoint: subscription.endpoint,
        pendingRegistration: false,
        pendingDeletion: false,
        relayDiagnostics: expect.objectContaining({ receipt }),
      }),
    ]);
    expect(await getAppPushStatus({ loadedInboxIds: ['inbox-1'], stateStore })).toMatchObject({
      state: 'enabled',
      pendingRegistrationCount: 0,
    });
  });

  it('still deletes a recovery-pending route during explicit Disable', async () => {
    class RecoveryPendingPushStateStore extends MemoryPushStateStore {
      private writes = 0;

      override async putRegistration(registration: Parameters<MemoryPushStateStore['putRegistration']>[0]): Promise<void> {
        this.writes += 1;
        if (this.writes === 2) throw new Error('IndexedDB persisted write failed');
        await super.putRegistration(registration);
      }
    }

    const stateStore = new RecoveryPendingPushStateStore();
    const subscription = createSubscription('https://push.example/recovery-disable');
    installPushBrowserMocks({ subscription });
    const receipt = 't'.repeat(43);
    const methods: string[] = [];
    const requestHeaders: Headers[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      requestHeaders.push(new Headers(init?.headers));
      return new Response(JSON.stringify({
        success: true,
        data: init?.method === 'POST' ? {
          diagnostics: {
            receipt,
            statusPath: '/api/xmtp/status',
            testPath: '/api/xmtp/status/test',
          },
        } : {},
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result.success).toBe(false);
    expect(methods).toEqual(['POST']);
    expect(await disablePush({ stateStore, fetchFn: fetchFn as unknown as typeof fetch })).toBe(true);
    expect(methods).toEqual(['POST', 'DELETE']);
    expect(requestHeaders[1]?.get('Authorization')).toBe(`Bearer ${receipt}`);
    expect(await stateStore.listRegistrations()).toEqual([]);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
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
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
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

  it('disables cached push state when the service worker API is unavailable', async () => {
    const stateStore = new MemoryPushStateStore();
    await stateStore.setPreferences({ enabled: true, updatedAt: 1 });
    vi.stubGlobal('navigator', {} as Navigator);

    const disabled = await disablePush({ identity, stateStore });

    expect(disabled).toBe(true);
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('skips service worker registration when unsupported', async () => {
    vi.stubGlobal('navigator', {} as Navigator);
    const result = await registerServiceWorkerForPush();
    expect(result).toBeNull();
  });
});
