import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildVapidPartyXmtpRegistrationPayload,
  cacheInboxPushRegistration,
  clearPushActivityForInbox,
  disablePush,
  enablePushForLoadedInboxes,
  enablePushForCurrentUser,
  getAppPushStatus,
  getPushPermissionStatus,
  isPushEnabled,
  isPushRegistrationRefreshReady,
  listPendingPushActivity,
  listenForPushActivityCleared,
  normalizeXmtpHmacKeys,
  refreshPushRegistrationForInbox,
  removePushRegistrationForInbox,
  updatePushInboxProfile,
  type XmtpPushIdentity,
  type XmtpPushTopic,
} from './subscribe';
import { MemoryPushStateStore, pushRegistrationKey } from './state';
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

    expect(payload.identity).toEqual(identity);
    expect(payload.preferences).toEqual({
      minimalPayloadOnly: true,
      plaintextPreview: false,
    });
    expect(payload.xmtp.topics).toEqual(topics);
    expect(payload.notification.inboxHandle).toBe('legacy-current-inbox');
    expect(JSON.stringify(payload)).not.toMatch(/messageBody|previewText|body/);
  });

  it('uses one browser subscription and upserts active plus cached inactive inboxes', async () => {
    const stateStore = new MemoryPushStateStore();
    const inactiveIdentity: XmtpPushIdentity = {
      inboxId: 'inbox-2',
      installationId: 'install-2',
    };
    await cacheInboxPushRegistration(
      {
        identity: inactiveIdentity,
        topics: [{ topic: '/xmtp/mls/1/inactive', hmacKeys: [{ epoch: '2', key: 'inactive-key' }] }],
        displayName: 'Blue Heron',
        inboxHandle: 'opaque-inbox-two',
      },
      { stateStore, now: 10 },
    );

    const subscription = createSubscription();
    const { pushManager } = installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as Mock;

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
        vapidPublicKey: 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik',
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result).toMatchObject({ success: true, registeredInboxCount: 2, topicCount: 2 });
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

    const secondIdentity = { inboxId: 'inbox-2', installationId: 'install-2' };
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
      return new Response('{}', { status: 200 });
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

    const retryFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as Mock;
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
    const nextIdentity = { ...identity, installationId: 'install-new' };
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
    const oldIdentity = { ...identity, installationId: 'install-old' };
    const oldRegistration = await cacheInboxPushRegistration(
      { identity: oldIdentity, topics, inboxHandle: 'opaque-replaced-handle' },
      { stateStore, now: 1 },
    );
    await stateStore.putRegistration({ ...oldRegistration, endpoint: subscription.endpoint });
    await stateStore.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: 1 });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result.success).toBe(true);
    expect(methods).toEqual(['POST', 'DELETE']);
    const registrations = await stateStore.listRegistrations();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.identity.installationId).toBe('install-1');
    expect(registrations[0]?.inboxHandle).toBe('opaque-replaced-handle');
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
    const secondIdentity = { inboxId: 'inbox-2', installationId: 'install-2' };
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
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as Mock;

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
