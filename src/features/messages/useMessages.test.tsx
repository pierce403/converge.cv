import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessages } from './useMessages';
import { useAuthStore, useContactStore, useConversationStore, useMessageStore } from '@/lib/stores';
import type { Conversation } from '@/types';
import type { Contact } from '@/lib/stores/contact-store';

const xmtpMock = {
  resolveInboxIdForAddress: vi.fn(),
  refreshInboxProfile: vi.fn(),
  sendMessage: vi.fn(),
};

const mockStorage = {
  putMessage: vi.fn(async () => undefined),
  updateMessageStatus: vi.fn(async () => undefined),
  deleteMessage: vi.fn(async () => undefined),
};

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => xmtpMock,
}));

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useMessages>) => void }) {
  const api = useMessages();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

describe('useMessages resolver usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const conversation: Conversation = {
      id: 'c1',
      peerId: '0x1111111111111111111111111111111111111111',
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
      conversations: [conversation],
      activeConversationId: null,
      isLoading: false,
    });
    useMessageStore.setState({
      messagesByConversation: {},
      loadingConversations: {},
      loadedConversations: {},
      isSending: false,
    });
    useAuthStore.setState({
      identity: {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        inboxId: 'self-inbox',
      } as never,
      isAuthenticated: true,
      isVaultUnlocked: true,
      vaultSecrets: null,
    });

    const upsertContactProfile = vi.fn(async (profile: unknown) => profile as Contact);
    const isContact = vi.fn(() => false);
    useContactStore.setState((state) => ({
      ...state,
      contacts: [],
      upsertContactProfile: upsertContactProfile as unknown as typeof state.upsertContactProfile,
      isContact: isContact as unknown as typeof state.isContact,
    }));

    xmtpMock.resolveInboxIdForAddress.mockResolvedValue('b'.repeat(64));
    xmtpMock.refreshInboxProfile.mockResolvedValue({
      inboxId: 'b'.repeat(64),
      displayName: 'Peer',
      avatarUrl: undefined,
      primaryAddress: '0x1111111111111111111111111111111111111111',
      addresses: ['0x1111111111111111111111111111111111111111'],
      identities: [],
    });
    xmtpMock.sendMessage.mockResolvedValue({
      id: 'remote-1',
      conversationId: 'c1',
      senderAddress: 'self-inbox',
      content: 'hello',
      sentAt: Date.now(),
      isLocalFallback: false,
    });
  });

  it('resolves inbox ID only once per send preflight', async () => {
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendMessage('c1', 'hello');
    });

    expect(xmtpMock.resolveInboxIdForAddress).toHaveBeenCalledTimes(1);
    expect(xmtpMock.resolveInboxIdForAddress).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      { context: 'useMessages:ensureContactForConversation' },
    );
  });
});
