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
  sendAttachment: vi.fn(),
  sendReadReceipt: vi.fn(),
};

const mockStorage = {
  putMessage: vi.fn(async () => undefined),
  putAttachment: vi.fn(async () => undefined),
  getAttachment: vi.fn(async () => null),
  deleteAttachment: vi.fn(async () => undefined),
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
    xmtpMock.sendAttachment.mockResolvedValue({
      id: 'remote-attachment-1',
      conversationId: 'c1',
      senderAddress: 'self-inbox',
      content: 'photo.png',
      sentAt: Date.now(),
      isLocalFallback: false,
    });
    xmtpMock.sendReadReceipt.mockResolvedValue(undefined);
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

  it('refuses to send from local-only fallback conversations', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    useConversationStore.setState({
      conversations: [
        {
          id: 'local-conversation-1',
          peerId: '0x1111111111111111111111111111111111111111',
          lastMessageAt: 0,
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: 0,
          isGroup: false,
          isLocalOnly: true,
        } as Conversation,
      ],
      activeConversationId: null,
      isLoading: false,
    });

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendMessage('local-conversation-1', 'hello');
    });

    expect(xmtpMock.resolveInboxIdForAddress).not.toHaveBeenCalled();
    expect(xmtpMock.sendMessage).not.toHaveBeenCalled();
    expect(mockStorage.putMessage).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui:toast',
      }),
    );
    dispatchSpy.mockRestore();
  });

  it('marks an attachment failed and surfaces the XMTP publish error', async () => {
    const publishError = new Error('Uploaded attachment could not be verified');
    xmtpMock.sendAttachment.mockRejectedValueOnce(publishError);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    const bytes = new Uint8Array([1, 2, 3]);
    const file = {
      name: 'photo.png',
      type: 'image/png',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    } as File;
    await act(async () => {
      await api!.sendAttachment('c1', file);
    });

    const messages = useMessageStore.getState().messagesByConversation.c1;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'attachment',
      body: 'photo.png',
      status: 'failed',
    });
    expect(mockStorage.updateMessageStatus).toHaveBeenCalledWith(messages[0].id, 'failed');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui:toast',
        detail: publishError.message,
      }),
    );

    dispatchSpy.mockRestore();
  });

  it('does not send read receipts for self DMs', async () => {
    useConversationStore.setState({
      conversations: [
        {
          id: 'c1',
          peerId: 'self-inbox',
          lastMessageAt: 0,
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: 0,
          isGroup: false,
        } as Conversation,
      ],
      activeConversationId: null,
      isLoading: false,
    });

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendReadReceiptFor('c1', Date.now() - 10_000);
    });

    expect(xmtpMock.sendReadReceipt).not.toHaveBeenCalled();
  });

  it('throttles repeated read receipts even when latest message timestamps are old', async () => {
    useConversationStore.setState({
      conversations: [
        {
          id: 'c1',
          peerId: 'peer-inbox',
          lastMessageAt: 0,
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: 0,
          isGroup: false,
        } as Conversation,
      ],
      activeConversationId: null,
      isLoading: false,
    });

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendReadReceiptFor('c1', 1_000);
      await api!.sendReadReceiptFor('c1', 1_001);
    });

    expect(xmtpMock.sendReadReceipt).toHaveBeenCalledTimes(1);
  });
});
