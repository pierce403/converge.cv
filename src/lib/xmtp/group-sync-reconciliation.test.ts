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

describe('XmtpClient group reconciliation', () => {
  let storedConversation: Conversation;

  beforeEach(() => {
    vi.clearAllMocks();
    storedConversation = {
      id: 'group-1',
      peerId: 'inbox-sender',
      createdAt: 1,
      lastMessageAt: 2,
      unreadCount: 0,
      pinned: false,
      archived: false,
      isGroup: false,
      groupName: 'Stale local name',
    };
    const storage = {
      getConversation: vi.fn(async () => storedConversation),
      putConversation: vi.fn(async (conversation: Conversation) => {
        storedConversation = conversation;
      }),
      listConversations: vi.fn(async () => [storedConversation]),
    };
    mocks.getStorage.mockResolvedValue(storage);
    useConversationStore.setState({
      conversations: [storedConversation],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('promotes an existing DM-shaped row when the SDK reports a group', async () => {
    const group = {
      id: 'group-1',
      createdAtNs: 1_000_000n,
      name: 'Network group name',
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
        {
          inboxId: 'peer-inbox',
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
    const xmtp = new XmtpClient();
    (xmtp as unknown as { client: unknown }).client = {
      inboxId: 'self-inbox',
      conversations: {
        sync: vi.fn(async () => undefined),
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

    await xmtp.syncConversations({ force: true, reason: 'test' });

    expect(storedConversation).toMatchObject({
      id: 'group-1',
      isGroup: true,
      peerId: 'group-1',
      topic: 'group-1',
      groupName: 'Network group name',
      memberInboxes: ['self-inbox', 'peer-inbox'],
    });
    expect(useConversationStore.getState().conversations[0]).toMatchObject({
      id: 'group-1',
      isGroup: true,
      peerId: 'group-1',
    });
  });
});
