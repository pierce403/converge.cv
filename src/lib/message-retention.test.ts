import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';

const retentionMocks = vi.hoisted(() => ({
  namespace: 'inbox-a',
  pruneMessages: vi.fn(),
  inactivePruneMessages: vi.fn(),
  inactiveClose: vi.fn(),
  openStorageNamespace: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorageNamespace: () => retentionMocks.namespace,
  getStorage: vi.fn(async () => ({ pruneMessages: retentionMocks.pruneMessages })),
  openStorageNamespace: retentionMocks.openStorageNamespace,
}));

import {
  MESSAGE_RETENTION_SWEEP_INTERVAL_MS,
  runLoadedInboxMessageRetention,
  runMessageRetention,
  startMessageRetentionScheduler,
} from './message-retention';
import { getMessageRetentionCutoff } from './message-retention-policy';
import { useConversationStore } from './stores/conversation-store';
import { useInboxRegistryStore } from './stores/inbox-registry-store';
import { useMessageStore } from './stores/message-store';

const conversation: Conversation = {
  id: 'conversation',
  peerId: 'peer',
  createdAt: 1,
  lastMessageAt: 1,
  unreadCount: 0,
  pinned: false,
  archived: false,
};

describe('message retention sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retentionMocks.namespace = 'inbox-a';
    localStorage.clear();
    retentionMocks.openStorageNamespace.mockImplementation(async () => ({
      pruneMessages: retentionMocks.inactivePruneMessages,
      close: retentionMocks.inactiveClose,
    }));
    retentionMocks.inactivePruneMessages.mockResolvedValue({
      deletedMessageIds: [],
      updatedConversations: [],
    });
    retentionMocks.inactiveClose.mockResolvedValue(undefined);
    useInboxRegistryStore.setState({ entries: [], currentInboxId: null, isHydrated: false });
    useConversationStore.setState({
      conversations: [conversation],
      activeConversationId: null,
      isLoading: false,
    });
    useMessageStore.setState({
      messagesByConversation: {
        conversation: [
          {
            id: 'expired',
            conversationId: 'conversation',
            sender: 'peer',
            sentAt: 1,
            type: 'text',
            body: 'expired',
            status: 'delivered',
            reactions: [],
          },
        ],
      },
      loadingConversations: {},
      loadedConversations: { conversation: true },
      isSending: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the database cascade result to in-memory messages and previews', async () => {
    const updated = {
      ...conversation,
      lastMessageAt: conversation.createdAt,
      lastMessagePreview: undefined,
      lastMessageId: undefined,
    };
    retentionMocks.pruneMessages.mockResolvedValue({
      deletedMessageIds: ['expired'],
      updatedConversations: [updated],
    });

    await runMessageRetention(2_000_000_000_000);

    expect(retentionMocks.pruneMessages).toHaveBeenCalledWith(
      getMessageRetentionCutoff(2_000_000_000_000),
      2_000_000_000_000,
    );
    expect(useMessageStore.getState().messagesByConversation.conversation).toEqual([]);
    expect(useConversationStore.getState().conversations[0]).toMatchObject(updated);
  });

  it('prunes every loaded inactive inbox without switching the active namespace', async () => {
    localStorage.setItem(
      'converge.inboxRegistry.v1',
      JSON.stringify([
        {
          inboxId: 'inbox-a',
          displayLabel: 'Active',
          primaryDisplayIdentity: 'active',
          lastOpenedAt: 2,
          hasLocalDB: true,
        },
        {
          inboxId: 'inbox-b',
          displayLabel: 'Inactive',
          primaryDisplayIdentity: 'inactive',
          lastOpenedAt: 1,
          hasLocalDB: true,
        },
        {
          inboxId: 'inbox-c',
          displayLabel: 'No local data',
          primaryDisplayIdentity: 'remote',
          lastOpenedAt: 0,
          hasLocalDB: false,
        },
      ]),
    );
    retentionMocks.pruneMessages.mockResolvedValue({
      deletedMessageIds: [],
      updatedConversations: [],
    });

    await runLoadedInboxMessageRetention(2_000_000_000_000);

    const cutoff = getMessageRetentionCutoff(2_000_000_000_000);
    expect(retentionMocks.openStorageNamespace).toHaveBeenCalledOnce();
    expect(retentionMocks.openStorageNamespace).toHaveBeenCalledWith('inbox-b');
    expect(retentionMocks.inactivePruneMessages).toHaveBeenCalledWith(
      cutoff,
      2_000_000_000_000,
    );
    expect(retentionMocks.inactiveClose).toHaveBeenCalledOnce();
    expect(retentionMocks.namespace).toBe('inbox-a');
  });

  it('single-flights open, hourly, and visibility-resume sweeps', async () => {
    vi.useFakeTimers();
    let resolveSweep: ((value: { deletedMessageIds: string[]; updatedConversations: [] }) => void) | undefined;
    retentionMocks.pruneMessages.mockImplementation(
      async () =>
        await new Promise<{ deletedMessageIds: string[]; updatedConversations: [] }>((resolve) => {
          resolveSweep = resolve;
        }),
    );

    const stop = startMessageRetentionScheduler();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MESSAGE_RETENTION_SWEEP_INTERVAL_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(retentionMocks.pruneMessages).toHaveBeenCalledTimes(1);

    resolveSweep?.({ deletedMessageIds: [], updatedConversations: [] });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MESSAGE_RETENTION_SWEEP_INTERVAL_MS);
    expect(retentionMocks.pruneMessages).toHaveBeenCalledTimes(2);
    stop();
  });
});
