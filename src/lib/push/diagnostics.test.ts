// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInboxRegistryStore } from '@/lib/stores/inbox-registry-store';
import { useConversationStore } from '@/lib/stores/conversation-store';
import {
  getPushDiagnosticSnapshot,
  getRelayPushRegistrationStatus,
  sendRelayPushDiagnosticTest,
  waitForRelayPushDiagnosticReceipt,
} from './diagnostics';
import { MemoryPushStateStore, type CachedInboxPushRegistration } from './state';

const RECEIPT = 'r'.repeat(43);
const INSTALLATION_ID = '1'.repeat(64);

function registration(): CachedInboxPushRegistration {
  return {
    key: `inbox-1::${INSTALLATION_ID}`,
    identity: { inboxId: 'inbox-1', installationId: INSTALLATION_ID },
    inboxHandle: 'opaque-handle-1',
    topics: [
      {
        topic: `/xmtp/mls/1/g-${'a'.repeat(32)}/proto`,
        hmacKeys: [{ epoch: '8', key: 'AQID' }],
      },
      {
        topic: `/xmtp/mls/1/w-${INSTALLATION_ID}/proto`,
        hmacKeys: [],
      },
    ],
    endpoint: 'https://push.example/subscription',
    relayDiagnostics: {
      receipt: RECEIPT,
      statusPath: '/api/xmtp/status',
      testPath: '/api/xmtp/status/test',
    },
    updatedAt: Date.now(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useInboxRegistryStore.setState({
    entries: [],
    currentInboxId: null,
    isHydrated: false,
  });
  useConversationStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
});

describe('push relay diagnostics', () => {
  it('uses the capability only in an authorization header and parses separate delivery stages', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        success: true,
        data: {
          version: 1,
          checkedAt: '2026-07-15T00:00:00.000Z',
          registration: {
            status: 'active',
            coverage: 'complete',
            registeredAt: '2026-07-14T23:55:00.000Z',
            updatedAt: '2026-07-14T23:56:00.000Z',
            groupTopicCount: 1,
            welcomeTopicCount: 1,
            hmacEpochCount: 1,
          },
          route: { status: 'synced' },
          pipeline: { deliveryReady: true, listenerStatus: 'ready', bridgeStatus: 'synced' },
          deliveries: {
            xmtp: {
              status: 'sent',
              lastMatchedAt: '2026-07-14T23:59:58.000Z',
              providerAcceptedAt: '2026-07-14T23:59:59.000Z',
            },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await getRelayPushRegistrationStatus(registration(), {
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result).toMatchObject({
      state: 'verified',
      groupTopicCount: 1,
      hmacEpochCount: 1,
      routeStatus: 'synced',
      lastMatchedAt: '2026-07-14T23:59:58.000Z',
      providerAcceptedAt: '2026-07-14T23:59:59.000Z',
    });
    const [input, init] = fetchFn.mock.calls[0];
    expect(String(input)).toBe('https://vapid.party/api/xmtp/status');
    expect(String(input)).not.toContain(RECEIPT);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${RECEIPT}`);
    expect(init?.body).toBeUndefined();
  });

  it.each([
    {},
    { success: true, data: { version: 1, registration: { status: 'active' } } },
  ])('fails closed for a successful but malformed status response', async (body) => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(getRelayPushRegistrationStatus(registration(), {
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as typeof fetch,
    })).resolves.toMatchObject({
      state: 'unreachable',
      detail: expect.stringContaining('unrecognized response shape'),
    });
  });

  it('queues a test against the fixed capability route without sending identifiers', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: { queued: true, testId: 'diagnostic_test_123', checkedAt: '2026-07-15T00:00:00.000Z' },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    const result = await sendRelayPushDiagnosticTest(registration(), {
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result).toEqual({
      queued: true,
      testId: 'diagnostic_test_123',
      checkedAt: '2026-07-15T00:00:00.000Z',
    });
    const [input, init] = fetchFn.mock.calls[0];
    expect(String(input)).toBe('https://vapid.party/api/xmtp/status/test');
    expect(init?.body).toBeUndefined();
  });

  it('recognizes an exact relay receipt that arrived before the test response was handled', async () => {
    const stateStore = new MemoryPushStateStore();
    await stateStore.putLastDiagnosticReceipt({
      testId: 'already_received_test',
      receivedAt: Date.now(),
      source: 'relay',
    });

    await expect(waitForRelayPushDiagnosticReceipt('already_received_test', {
      stateStore,
      timeoutMs: 10,
      pollIntervalMs: 1,
    })).resolves.toMatchObject({
      testId: 'already_received_test',
      source: 'relay',
    });
  });

  it('rejects a malformed successful relay-test response', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { queued: true, testId: 'bad id', checkedAt: 'not-a-date' },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    await expect(sendRelayPushDiagnosticTest(registration(), {
      apiBase: 'https://vapid.party/api',
      fetchFn: fetchFn as typeof fetch,
    })).rejects.toThrow('unrecognized response shape');
  });

  it('re-reads the inbox registry after hydration', async () => {
    localStorage.setItem('converge.inboxRegistry.v1', JSON.stringify([{
      inboxId: 'inbox-hydrated',
      displayLabel: 'Orange Orca',
      primaryDisplayIdentity: 'Orange Orca',
      lastOpenedAt: Date.now(),
      hasLocalDB: true,
    }]));
    useInboxRegistryStore.setState({ entries: [], currentInboxId: null, isHydrated: false });
    useConversationStore.setState({
      conversations: [{
        id: 'local-conversation-default',
        peerId: 'local-peer',
        lastMessageAt: 0,
        unreadCount: 0,
        pinned: false,
        archived: false,
        createdAt: 0,
        isLocalOnly: true,
      }],
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => []) },
    });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: 'healthy', xmtp: { deliveryReady: false } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const snapshot = await getPushDiagnosticSnapshot({
      stateStore: new MemoryPushStateStore(),
      fetchFn: fetchFn as typeof fetch,
    });

    expect(snapshot.app.expectedInboxCount).toBe(1);
    expect(snapshot.activeConversationCount).toBe(0);
    expect(useInboxRegistryStore.getState().entries[0]?.displayLabel).toBe('Orange Orca');
  });
});
