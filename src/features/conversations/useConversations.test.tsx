import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { useConversations, groupDetailsToConversationUpdates } from './useConversations';
import { useConversationStore, useAuthStore } from '@/lib/stores';
import type { Conversation } from '@/types';
import { getAddress } from 'viem';
type GroupDetailsLike = Parameters<typeof groupDetailsToConversationUpdates>[0];

let conversationRecord: Conversation;
const xmtpMock = {
  addMembersToGroup: vi.fn(),
  removeMembersFromGroup: vi.fn(),
  resolveInboxIdForAddress: vi.fn(),
  isConnected: vi.fn(() => false),
  getInboxId: vi.fn(() => null),
};

const mockStorage = {
  getConversation: vi.fn(async () => conversationRecord),
  putConversation: vi.fn(async (conv: Conversation) => {
    conversationRecord = conv;
  }),
  listConversations: vi.fn(async (): Promise<Conversation[]> => []),
  isPeerDeleted: vi.fn(async () => false),
  markConversationDeleted: vi.fn(async () => undefined),
  unmarkConversationDeletion: vi.fn(async () => undefined),
  unmarkPeerDeletion: vi.fn(async () => undefined),
  deleteConversation: vi.fn(async () => undefined),
  vacuum: vi.fn(async () => undefined),
};

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => xmtpMock,
}));

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useConversations>) => void }) {
  const api = useConversations();
  // expose the hook methods for testing
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

describe('useConversations controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationRecord = {
      id: 'c1',
      peerId: 'peer-1',
      lastMessageAt: 0,
      unreadCount: 0,
      pinned: false,
      archived: false,
      createdAt: 0,
      lastMessagePreview: '',
      lastMessageSender: '',
      isGroup: false,
    };
    useConversationStore.setState({
      conversations: [conversationRecord],
      activeConversationId: null,
      isLoading: false,
    });
    useAuthStore.setState({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    });
    xmtpMock.addMembersToGroup.mockReset();
    xmtpMock.removeMembersFromGroup.mockReset();
    xmtpMock.resolveInboxIdForAddress.mockReset();
    xmtpMock.isConnected.mockReset();
    xmtpMock.getInboxId.mockReset();
    xmtpMock.isConnected.mockReturnValue(false);
    xmtpMock.getInboxId.mockReturnValue(null);
    mockStorage.listConversations.mockResolvedValue([]);
    mockStorage.isPeerDeleted.mockResolvedValue(false);
  });

  it('toggles mute/unmute and records deletion markers', async () => {
    let api: ReturnType<typeof useConversations> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.toggleMute('c1');
    });

    expect(conversationRecord.mutedUntil).toBeDefined();
    expect(mockStorage.markConversationDeleted).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', reason: 'user-muted' })
    );

    await act(async () => {
      await api!.toggleMute('c1');
    });

    expect(conversationRecord.mutedUntil).toBeUndefined();
    expect(mockStorage.unmarkConversationDeletion).toHaveBeenCalledWith('c1');
    expect(mockStorage.unmarkPeerDeletion).toHaveBeenCalledWith('peer-1');
  });

  it('hides conversations and clears local state', async () => {
    let api: ReturnType<typeof useConversations> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.hideConversation('c1', { reason: 'user-hidden' });
    });

    expect(mockStorage.markConversationDeleted).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', reason: 'user-hidden' })
    );
    expect(mockStorage.deleteConversation).toHaveBeenCalledWith('c1');
    expect(useConversationStore.getState().conversations).toHaveLength(0);
  });
});

describe('group membership operations', () => {
  beforeEach(() => {
    conversationRecord = {
      id: 'g1',
      peerId: 'g1',
      lastMessageAt: 0,
      unreadCount: 0,
      pinned: false,
      archived: false,
      createdAt: 0,
      lastMessagePreview: '',
      lastMessageSender: '',
      isGroup: true,
      members: ['0x1111111111111111111111111111111111111111'],
      memberInboxes: ['inbox-a'],
      admins: [],
    };
    useConversationStore.setState({
      conversations: [conversationRecord],
      activeConversationId: null,
      isLoading: false,
    });
    xmtpMock.addMembersToGroup.mockReset();
    xmtpMock.removeMembersFromGroup.mockReset();
  });

  it('adds group members and persists XMTP updates', async () => {
    const memberA = getAddress('0x1111111111111111111111111111111111111111');
    const memberB = getAddress('0x2222222222222222222222222222222222222222');
    const details = {
      id: 'g1',
      members: [
        {
          inboxId: 'inbox-a',
          address: memberA,
          permissionLevel: 1,
          isAdmin: true,
          isSuperAdmin: false,
        },
        {
          inboxId: 'inbox-b',
          address: memberB,
          permissionLevel: 1,
          isAdmin: false,
          isSuperAdmin: false,
        },
      ],
      adminAddresses: [memberA],
      adminInboxes: ['inbox-a'],
      superAdminInboxes: [],
      name: 'Test Group',
      imageUrl: '',
      description: '',
    } as unknown as GroupDetailsLike;

    xmtpMock.addMembersToGroup.mockResolvedValue(details);

    let api: ReturnType<typeof useConversations> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.addMembersToGroup('g1', [memberA, memberB]);
    });

    expect(xmtpMock.addMembersToGroup).toHaveBeenCalledWith('g1', [memberB]);
    expect(conversationRecord.memberInboxes).toEqual(['inbox-a', 'inbox-b']);
  });

  it('removes group members and persists XMTP updates', async () => {
    const memberA = getAddress('0x1111111111111111111111111111111111111111');
    const details = {
      id: 'g1',
      members: [
        {
          inboxId: 'inbox-a',
          address: memberA,
          permissionLevel: 1,
          isAdmin: true,
          isSuperAdmin: false,
        },
      ],
      adminAddresses: [memberA],
      adminInboxes: ['inbox-a'],
      superAdminInboxes: [],
      name: 'Test Group',
      imageUrl: '',
      description: '',
    } as unknown as GroupDetailsLike;

    xmtpMock.removeMembersFromGroup.mockResolvedValue(details);

    let api: ReturnType<typeof useConversations> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.removeMembersFromGroup('g1', ['inbox-b']);
    });

    expect(xmtpMock.removeMembersFromGroup).toHaveBeenCalledWith('g1', ['inbox-b']);
    expect(conversationRecord.memberInboxes).toEqual(['inbox-a']);
  });
});

describe('groupDetailsToConversationUpdates', () => {
  it('normalizes group metadata and membership', () => {
    const details = {
      id: 'g1',
      peerId: 'peer-group',
      members: [
        {
          inboxId: 'inbox-a',
          address: '0x1111111111111111111111111111111111111111',
          permissionLevel: 1,
          isAdmin: true,
          isSuperAdmin: false,
        },
        {
          inboxId: 'inbox-b',
          address: '0x1111111111111111111111111111111111111111',
          permissionLevel: 1,
          isAdmin: false,
          isSuperAdmin: true,
        },
      ],
      adminAddresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'],
      adminInboxes: ['inbox-a'],
      superAdminInboxes: ['inbox-b', 'inbox-b'],
      name: 'Test Group',
      imageUrl: 'https://example.com/group.png',
      description: 'group description',
      permissions: {
        policyType: 1,
        policySet: {
          addMemberPolicy: 1,
          removeMemberPolicy: 2,
          addAdminPolicy: 3,
          removeAdminPolicy: 4,
          updateGroupNamePolicy: 5,
          updateGroupDescriptionPolicy: 5,
          updateGroupImageUrlSquarePolicy: 2,
          updateMessageDisappearingPolicy: 1,
        },
      },
      // Unused fields for this test
      permissionsV2: undefined,
      pinnedFrameUrl: undefined,
    } as unknown as GroupDetailsLike;

    const updates = groupDetailsToConversationUpdates(details);

    expect(updates.groupName).toBe('Test Group');
    expect(updates.groupImage).toBe('https://example.com/group.png');
    expect(updates.groupDescription).toBe('group description');
    expect(updates.members).toHaveLength(1);
    expect(updates.admins).toHaveLength(2);
    expect(updates.memberInboxes).toEqual(['inbox-a', 'inbox-b']);
    expect(updates.superAdminInboxes).toEqual(['inbox-b']);
    expect(updates.groupPermissions?.policySet.addMemberPolicy).toBe(1);
  });
});

describe('loadConversations identity lookup dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    });
  });

  it('uses a single resolver lookup for address-like peer IDs during cleanup', async () => {
    const peerAddress = '0x1111111111111111111111111111111111111111';
    const resolvedInbox = 'f'.repeat(64);
    const seededConversation: Conversation = {
      id: 'addr-conv',
      peerId: peerAddress,
      lastMessageAt: 0,
      unreadCount: 0,
      pinned: false,
      archived: false,
      createdAt: 0,
      lastMessagePreview: '',
      lastMessageSender: '',
      isGroup: false,
    };

    mockStorage.listConversations.mockResolvedValue([seededConversation]);
    xmtpMock.isConnected.mockReturnValue(true);
    xmtpMock.resolveInboxIdForAddress.mockResolvedValue(resolvedInbox);

    let api: ReturnType<typeof useConversations> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.loadConversations();
    });

    await waitFor(() => {
      expect(xmtpMock.resolveInboxIdForAddress).toHaveBeenCalledTimes(1);
    });
    expect(xmtpMock.resolveInboxIdForAddress).toHaveBeenCalledWith(
      peerAddress.toLowerCase(),
      { context: 'useConversations:loadConversations:cleanup' },
    );
  });
});
