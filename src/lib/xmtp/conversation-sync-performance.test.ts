import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';
import { useConversationStore } from '@/lib/stores';

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: mocks.getStorage,
}));

import { XmtpClient } from './client';
import {
  registerXmtpDurableSideEffectConsumer,
  registerXmtpMessageConsumer,
  type XmtpMessageConsumer,
} from './message-events';
import { DEFAULT_MESSAGE_RETENTION_MS } from '@/lib/message-retention-policy';
import { ContentTypeConvosJoinRequest } from './convos-codecs';

function registerDurableConsumers(
  consume: XmtpMessageConsumer
): () => void {
  const unregisterMessage = registerXmtpMessageConsumer(consume);
  const unregisterSideEffects =
    registerXmtpDurableSideEffectConsumer(async () => undefined);
  return () => {
    unregisterMessage();
    unregisterSideEffects();
  };
}

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
      updateConversationSyncState: vi.fn(async (id: string, lastSyncedAt: number) => {
        const existing = storedConversations.get(id);
        if (existing) {
          storedConversations.set(id, { ...existing, lastSyncedAt });
        }
      }),
      listConversations: vi.fn(async () => Array.from(storedConversations.values())),
      isConversationDeleted: vi.fn(async () => false),
    };
    mocks.getStorage.mockResolvedValue(storage);
    useConversationStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('does not overlap a non-cancellable sync after its local deadline', async () => {
    vi.useFakeTimers();
    const xmtp = new XmtpClient();
    let finishSync: (() => void) | undefined;
    const sync = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          finishSync = resolve;
        })
    );
    (xmtp as unknown as { client: unknown }).client = {
      conversations: { sync },
    };
    const run = () =>
      (
        xmtp as unknown as {
          conversationsSyncWithRecovery: (reason: string) => Promise<void>;
        }
      ).conversationsSyncWithRecovery('timeout-regression');

    const first = run();
    const firstTimeout = expect(first).rejects.toThrow('conversations.sync timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await firstTimeout;

    const second = run();
    const secondTimeout = expect(second).rejects.toThrow('conversations.sync timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await secondTimeout;
    expect(sync).toHaveBeenCalledOnce();

    finishSync?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const third = run();
    await Promise.resolve();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(2);
    finishSync?.();
    await expect(third).resolves.toBeUndefined();
  });

  it('does not advance a message checkpoint when conversation sync fails', async () => {
    const xmtp = new XmtpClient();
    const originalCheckpoint = Date.now() - 60 * 60 * 1000;
    storedConversations.set('dm-checkpoint', {
      id: 'dm-checkpoint',
      peerId: 'peer-inbox',
      createdAt: originalCheckpoint,
      lastMessageAt: originalCheckpoint,
      lastSyncedAt: originalCheckpoint,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-checkpoint',
      sync: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
      messages: vi.fn(async () => []),
    };
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => undefined);

    try {
      await xmtp.syncHistory({
        mode: 'recent',
        skipConversationSync: true,
        force: true,
      });
    } finally {
      unregister();
    }

    expect(dm.sync).toHaveBeenCalled();
    expect(storedConversations.get('dm-checkpoint')?.lastSyncedAt).toBe(
      originalCheckpoint
    );
  });

  it('does not advance a checkpoint after an explicitly capped history read', async () => {
    const xmtp = new XmtpClient();
    const originalCheckpoint = Date.now() - 60 * 60 * 1000;
    storedConversations.set('dm-capped', {
      id: 'dm-capped',
      peerId: 'peer-inbox',
      createdAt: originalCheckpoint,
      lastMessageAt: originalCheckpoint,
      lastSyncedAt: originalCheckpoint,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-capped',
      sync: vi.fn(async () => undefined),
      messages: vi.fn(async () => []),
    };
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => undefined);

    try {
      await xmtp.syncHistory({
        mode: 'recent',
        messageLimit: 1,
        skipConversationSync: true,
        force: true,
      });
    } finally {
      unregister();
    }

    expect(dm.sync).toHaveBeenCalledOnce();
    expect(storedConversations.get('dm-capped')?.lastSyncedAt).toBe(
      originalCheckpoint
    );
  });

  it('replays the full retained window when only a preview timestamp exists', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-19T12:00:00.000Z').getTime();
    vi.setSystemTime(now);
    const xmtp = new XmtpClient();
    storedConversations.set('dm-no-checkpoint', {
      id: 'dm-no-checkpoint',
      peerId: 'peer-inbox',
      createdAt: now - 10 * 24 * 60 * 60 * 1000,
      lastMessageAt: now - 5_000,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-no-checkpoint',
      sync: vi.fn(async () => undefined),
      messages: vi.fn(async () => []),
    };
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => undefined);

    try {
      await xmtp.syncHistory({
        mode: 'recent',
        skipConversationSync: true,
        force: true,
      });
    } finally {
      unregister();
    }

    expect(dm.messages).toHaveBeenCalledWith({
      sentAfterNs: BigInt(now - DEFAULT_MESSAGE_RETENTION_MS) * 1_000_000n,
      limit: undefined,
    });
  });

  it('surfaces checkpoint persistence failures in strict history repair', async () => {
    const now = Date.now();
    storedConversations.set('dm-stamp-failure', {
      id: 'dm-stamp-failure',
      peerId: 'peer-inbox',
      createdAt: now - 60_000,
      lastMessageAt: now - 60_000,
      lastSyncedAt: now - 60_000,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const storage = await mocks.getStorage();
    storage.updateConversationSyncState.mockRejectedValueOnce(
      new Error('checkpoint write failed')
    );
    const dm = {
      id: 'dm-stamp-failure',
      sync: vi.fn(async () => undefined),
      messages: vi.fn(async () => []),
    };
    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => undefined);

    try {
      await expect(
        xmtp.syncHistory({
          mode: 'recent',
          skipConversationSync: true,
          force: true,
          strict: true,
        })
      ).rejects.toThrow('Failed to repair 1 conversation');
    } finally {
      unregister();
    }
  });

  it('ingests partial sync results but rejects a strict retained-history repair', async () => {
    const now = Date.now();
    storedConversations.set('dm-partial-sync', {
      id: 'dm-partial-sync',
      peerId: 'peer-inbox',
      createdAt: now - 60_000,
      lastMessageAt: now - 60_000,
      lastSyncedAt: now - 60_000,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-partial-sync',
      sync: vi.fn(async () => {
        throw new Error('messages synced but only some intents succeeded');
      }),
      messages: vi.fn(async () => []),
    };
    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => undefined);

    try {
      await expect(
        xmtp.syncHistory({
          mode: 'full',
          skipConversationSync: true,
          force: true,
          strict: true,
        })
      ).rejects.toThrow('Failed to repair 1 conversation');
    } finally {
      unregister();
    }

    expect(dm.messages).toHaveBeenCalledOnce();
    expect(storedConversations.get('dm-partial-sync')?.lastSyncedAt).toBe(
      now - 60_000
    );
  });

  it('propagates join-request persistence failures without stamping the checkpoint', async () => {
    const originalCheckpoint = Date.now() - 60 * 60 * 1000;
    storedConversations.set('dm-join-request', {
      id: 'dm-join-request',
      peerId: 'peer-inbox',
      createdAt: originalCheckpoint,
      lastMessageAt: originalCheckpoint,
      lastSyncedAt: originalCheckpoint,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-join-request',
      sync: vi.fn(async () => undefined),
      messages: vi.fn(async () => [
        {
          id: 'join-request-1',
          conversationId: 'dm-join-request',
          senderInboxId: 'peer-inbox',
          sentAtNs: BigInt(Date.now()) * 1_000_000n,
          content: { inviteSlug: 'join-example' },
          contentType: ContentTypeConvosJoinRequest,
        },
      ]),
    };
    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => {
      throw new Error('join request write failed');
    });

    try {
      await expect(
        xmtp.syncHistory({
          mode: 'full',
          skipConversationSync: true,
          force: true,
          strict: true,
        })
      ).rejects.toThrow('Failed to repair 1 conversation');
    } finally {
      unregister();
    }

    expect(storedConversations.get('dm-join-request')?.lastSyncedAt).toBe(
      originalCheckpoint
    );
  });

  it('propagates reply persistence failures instead of stamping the checkpoint', async () => {
    const xmtp = new XmtpClient();
    const originalCheckpoint = Date.now() - 60 * 60 * 1000;
    storedConversations.set('dm-reply', {
      id: 'dm-reply',
      peerId: 'peer-inbox',
      createdAt: originalCheckpoint,
      lastMessageAt: originalCheckpoint,
      lastSyncedAt: originalCheckpoint,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    const dm = {
      id: 'dm-reply',
      sync: vi.fn(async () => undefined),
      messages: vi.fn(async () => [
        {
          id: 'reply-1',
          conversationId: 'dm-reply',
          senderInboxId: 'peer-inbox',
          sentAtNs: BigInt(Date.now()) * 1_000_000n,
          content: { content: 'reply body', referenceId: 'original-1' },
          contentType: {
            authorityId: 'xmtp.org',
            typeId: 'reply',
            versionMajor: 1,
            versionMinor: 0,
          },
        },
      ]),
    };
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        listDms: vi.fn(async () => [dm]),
        list: vi.fn(async () => [dm]),
      },
    };
    const unregister = registerDurableConsumers(async () => {
      throw new Error('IndexedDB write failed');
    });

    try {
      await expect(
        xmtp.syncHistory({
          mode: 'recent',
          skipConversationSync: true,
          force: true,
          strict: true,
        })
      ).rejects.toThrow('Failed to repair 1 conversation');
    } finally {
      unregister();
    }

    expect(storedConversations.get('dm-reply')?.lastSyncedAt).toBe(
      originalCheckpoint
    );
  });
});
