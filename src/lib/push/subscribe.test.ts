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

const GROUP_ID_A = 'a'.repeat(64);
const GROUP_ID_B = 'b'.repeat(64);
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
    expect(registrations[0]?.identity.installationId).toBe(INSTALLATION_ID_A);
    expect(registrations[0]?.inboxHandle).toBe('opaque-replaced-handle');
  });

  it('deletes a replaced browser endpoint before caching the current endpoint', async () => {
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
    });
    await stateStore.setPreferences({ enabled: true, endpoint: cached.endpoint, updatedAt: 1 });
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async (_url, init) => {
      requests.push({
        method: String(init?.method),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as Mock;

    const result = await refreshPushRegistrationForInbox(
      { identity, topics, displayName: 'Orange Orca' },
      { stateStore, fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result.success).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['POST', 'DELETE']);
    expect(requests[1]?.body.endpoint).toBe('https://push.example/replaced');
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({ endpoint: subscription.endpoint, pendingDeletion: false }),
    ]);
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
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      return new Response('{}', { status: 200 });
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
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as Mock;
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
      new Response(JSON.stringify({ success: true, data: { subscriptionId: 'registration-1' } }), {
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
    });
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    const result = await enablePromise;

    expect(result).toMatchObject({
      success: true,
      endpoint: subscription.endpoint,
      registrationId: 'registration-1',
      topicCount: 2,
    });
    expect(navigatorMock.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(pushManager.subscribe).toHaveBeenCalled();

    const lastCall = fetchFn.mock.calls[fetchFn.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe('https://vapid.party/api/xmtp/subscriptions');
    expect(lastCall?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.stringify(lastCall?.[1]?.headers)).not.toMatch(/X-API-Key/i);
    const body = JSON.parse(String(lastCall?.[1]?.body));
    expect(body.identity).toEqual(identity);
    expect(body.xmtp.topics).toEqual(normalizeXmtpPushTopics(topics, identity.installationId));

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
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).toHaveBeenCalled();
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
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as Mock;

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

  it('rolls back the relay and browser endpoint when persistence fails after POST', async () => {
    class RejectingPersistedPushStateStore extends MemoryPushStateStore {
      private writes = 0;

      override async putRegistration(registration: Parameters<MemoryPushStateStore['putRegistration']>[0]): Promise<void> {
        this.writes += 1;
        if (this.writes === 2) throw new Error('IndexedDB persisted write failed');
        await super.putRegistration(registration);
      }
    }

    const stateStore = new RejectingPersistedPushStateStore();
    const subscription = createSubscription('https://push.example/rolled-back');
    installPushBrowserMocks({ subscription });
    const methods: string[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      methods.push(String(init?.method));
      return new Response(JSON.stringify({ success: true }), {
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
    expect(methods).toEqual(['POST', 'DELETE']);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect((await stateStore.getPreferences()).enabled).toBe(false);
  });

  it('retains a deletion tombstone when post-POST rollback also fails', async () => {
    class RollbackTombstonePushStateStore extends MemoryPushStateStore {
      private writes = 0;

      override async putRegistration(registration: Parameters<MemoryPushStateStore['putRegistration']>[0]): Promise<void> {
        this.writes += 1;
        if (this.writes === 2) throw new Error('IndexedDB persisted write failed');
        await super.putRegistration(registration);
      }
    }

    const stateStore = new RollbackTombstonePushStateStore();
    const subscription = createSubscription('https://push.example/rollback-tombstone');
    installPushBrowserMocks({ subscription });
    const fetchFn = vi.fn(async (_url, init) =>
      new Response('{}', { status: init?.method === 'DELETE' ? 503 : 200 })
    ) as unknown as Mock;

    const result = await enablePushForLoadedInboxes(
      [{ identity, topics }],
      {
        stateStore,
        vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
        fetchFn: fetchFn as unknown as typeof fetch,
      },
    );

    expect(result.success).toBe(false);
    expect(await stateStore.listRegistrations()).toEqual([
      expect.objectContaining({
        endpoint: subscription.endpoint,
        pendingDeletion: true,
      }),
    ]);
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

  it('skips service worker registration when unsupported', async () => {
    vi.stubGlobal('navigator', {} as Navigator);
    const result = await registerServiceWorkerForPush();
    expect(result).toBeNull();
  });
});
