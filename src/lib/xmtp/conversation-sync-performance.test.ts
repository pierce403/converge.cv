import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';
import { useConversationStore } from '@/lib/stores';

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: mocks.getStorage,
}));

import { XmtpClient } from './client';

describe('XmtpClient conversation sync performance', () => {
  let storedConversations: Map<string, Conversation>;

  beforeEach(() => {
    vi.clearAllMocks();
    storedConversations = new Map();

    const storage = {
      getConversation: vi.fn(async (id: string) => storedConversations.get(id)),
      putConversation: vi.fn(async (conversation: Conversation) => {
        storedConversations.set(conversation.id, conversation);
      }),
      listConversations: vi.fn(async () => Array.from(storedConversations.values())),
    };
    mocks.getStorage.mockResolvedValue(storage);
    useConversationStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('skips redundant group.sync() during bulk conversation sync', async () => {
    const groupSyncFn = vi.fn(async () => undefined);
    const group = {
      id: 'group-perf-1',
      createdAtNs: 1_000_000n,
      name: 'Fast Group',
      imageUrl: '',
      description: '',
      appData: '',
      sync: groupSyncFn,
      members: vi.fn(async () => [
        {
          inboxId: 'self-inbox',
          accountIdentifiers: [],
          permissionLevel: 0,
        },
      ]),
      listAdmins: vi.fn(async () => []),
      listSuperAdmins: vi.fn(async () => []),
      permissions: vi.fn(async () => undefined),
      updateName: vi.fn(async () => undefined),
      messages: vi.fn(async () => []),
      send: vi.fn(async () => 'message-id'),
    };

    const clientConversationsSyncFn = vi.fn(async () => undefined);

    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        sync: clientConversationsSyncFn,
        list: vi.fn(async () => [group]),
        listDms: vi.fn(async () => []),
        getConversationById: vi.fn(async () => group),
      },
    };

    (
      xmtp as unknown as {
        ensureConvosGroupProfilePublished: () => Promise<void>;
      }
    ).ensureConvosGroupProfilePublished = vi.fn(async () => undefined);

    await xmtp.syncConversations({ force: true, reason: 'test-perf' });

    // client.conversations.sync() should be called once for network updates
    expect(clientConversationsSyncFn).toHaveBeenCalledOnce();

    // Individual group.sync() MUST NOT be called during bulk conversation sync
    expect(groupSyncFn).not.toHaveBeenCalled();

    // Conversation is persisted in storage and UI store
    expect(storedConversations.get('group-perf-1')).toBeDefined();
    expect(storedConversations.get('group-perf-1')?.groupName).toBe('Fast Group');
    expect(useConversationStore.getState().conversations).toHaveLength(1);
  });

  it('persists multiple DMs and groups concurrently without hanging', async () => {
    const dms = Array.from({ length: 12 }, (_, i) => ({
      id: `dm-${i}`,
      createdAtNs: BigInt(1_000_000 * (i + 1)),
      peerInboxId: vi.fn(async () => `peer-inbox-${i}`),
    }));

    const groups = Array.from({ length: 12 }, (_, i) => ({
      id: `group-${i}`,
      createdAtNs: BigInt(1_000_000 * (i + 1)),
      name: `Group ${i}`,
      imageUrl: '',
      description: '',
      appData: '',
      sync: vi.fn(async () => undefined),
      members: vi.fn(async () => [
        {
          inboxId: 'self-inbox',
          accountIdentifiers: [],
          permissionLevel: 0,
        },
      ]),
      listAdmins: vi.fn(async () => []),
      listSuperAdmins: vi.fn(async () => []),
      permissions: vi.fn(async () => undefined),
      messages: vi.fn(async () => []),
      send: vi.fn(async () => `msg-${i}`),
    }));

    const allConversations = [...dms, ...groups];

    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        sync: vi.fn(async () => undefined),
        list: vi.fn(async () => allConversations),
        listDms: vi.fn(async () => dms),
        getConversationById: vi.fn(async (id: string) => groups.find((g) => g.id === id)),
      },
    };

    (
      xmtp as unknown as {
        ensureConvosGroupProfilePublished: () => Promise<void>;
      }
    ).ensureConvosGroupProfilePublished = vi.fn(async () => undefined);

    await xmtp.syncConversations({ force: true, reason: 'test-concurrency' });

    // Verify all 24 conversations were saved
    expect(storedConversations.size).toBe(24);
    for (let i = 0; i < 12; i++) {
      expect(storedConversations.get(`dm-${i}`)).toBeDefined();
      expect(storedConversations.get(`dm-${i}`)?.peerId).toBe(`peer-inbox-${i}`);
      expect(storedConversations.get(`group-${i}`)).toBeDefined();
      expect(storedConversations.get(`group-${i}`)?.groupName).toBe(`Group ${i}`);
    }
  });

  it('times out stalled operations without wedging', async () => {
    const xmtp = new XmtpClient();
    const neverResolves = new Promise<string>(() => {});

    await expect(
      (
        xmtp as unknown as {
          withTimeout: (label: string, p: Promise<string>, ms: number) => Promise<string>;
        }
      ).withTimeout('test-timeout', neverResolves, 50)
    ).rejects.toThrow('[XMTP] test-timeout timed out after 50ms');
  });
});
