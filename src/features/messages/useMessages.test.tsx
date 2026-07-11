import { useEffect } from 'react';
import { ConsentState } from '@xmtp/browser-sdk';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessages } from './useMessages';
import { useAuthStore, useContactStore, useConversationStore, useMessageStore } from '@/lib/stores';
import type { Attachment, Conversation, StoredRemoteAttachmentEnvelope } from '@/types';
import type { Contact } from '@/lib/stores/contact-store';

const xmtpMock = {
  resolveInboxIdForAddress: vi.fn(),
  refreshInboxProfile: vi.fn(),
  sendMessage: vi.fn(),
  sendAttachment: vi.fn(),
  sendReadReceipt: vi.fn(),
  loadRemoteAttachment: vi.fn(),
  updateConversationConsentState: vi.fn(),
};

const mockStorage = {
  putMessage: vi.fn(async () => undefined),
  getMessage: vi.fn(async () => undefined),
  getConversation: vi.fn(async () => undefined),
  putAttachment: vi.fn(async () => undefined),
  putAttachmentMetadata: vi.fn(async () => undefined),
  markAttachmentFailed: vi.fn(async () => true),
  getAttachment: vi.fn<
    (id: string) => Promise<{ attachment: Attachment; data: ArrayBuffer } | null>
  >(async () => null),
  getAttachmentMetadata: vi.fn<() => Promise<Attachment | undefined>>(async () => undefined),
  getAttachmentData: vi.fn<() => Promise<ArrayBuffer | undefined>>(async () => undefined),
  evictAttachmentData: vi.fn(async () => undefined),
  putRemoteAttachmentEnvelope: vi.fn(async () => undefined),
  getRemoteAttachmentEnvelope: vi.fn<() => Promise<StoredRemoteAttachmentEnvelope | undefined>>(
    async () => undefined,
  ),
  pruneAttachmentCache: vi.fn(async () => ({ usageBytes: 0, evictedIds: [] })),
  cacheRemoteAttachment: vi.fn(async () => ({ usageBytes: 0, evictedIds: [] })),
  reconcilePublishedAttachment: vi.fn(async () => undefined),
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

function pngBytes(): Uint8Array {
  const content = new Uint8Array(37);
  content.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(content.buffer);
  view.setUint32(8, 13, false);
  content.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 1, false);
  view.setUint32(20, 1, false);
  content[24] = 8;
  content[25] = 6;
  return content;
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
    xmtpMock.loadRemoteAttachment.mockResolvedValue({
      filename: 'photo.png',
      mimeType: 'image/png',
      content: new Uint8Array([1, 2, 3]),
    });
    xmtpMock.updateConversationConsentState.mockResolvedValue(undefined);
    mockStorage.getMessage.mockResolvedValue(undefined);
    mockStorage.getConversation.mockResolvedValue(undefined);
    mockStorage.getAttachment.mockResolvedValue(null);
    mockStorage.getAttachmentMetadata.mockResolvedValue(undefined);
    mockStorage.getAttachmentData.mockResolvedValue(undefined);
    mockStorage.getRemoteAttachmentEnvelope.mockResolvedValue(undefined);
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

    const bytes = pngBytes();
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

  it('rejects image formats that the inbound validator will not render', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendAttachment('c1', {
        name: 'animation.gif',
        type: 'image/gif',
        size: 3,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as File);
    });

    expect(xmtpMock.sendAttachment).not.toHaveBeenCalled();
    expect(mockStorage.putMessage).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui:toast',
        detail: 'Please select a JPEG, PNG, or WebP image.',
      }),
    );
    dispatchSpy.mockRestore();
  });

  it('rejects mislabeled outbound bytes before creating an optimistic message', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.sendAttachment('c1', {
        name: 'not-really.png',
        type: 'image/png',
        size: 16,
        arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
      } as File);
    });

    expect(xmtpMock.sendAttachment).not.toHaveBeenCalled();
    expect(mockStorage.putMessage).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui:toast',
        detail: 'Image must be a valid static JPEG, PNG, or WebP within the safety limits.',
      }),
    );
    dispatchSpy.mockRestore();
  });

  it('persists the authoritative attachment before deleting its optimistic row', async () => {
    const fileBytes = pngBytes();
    const remoteAttachment = {
      url: 'https://example.ipfscdn.io/photo.enc',
      contentDigest: 'digest',
      secret: new Uint8Array(32).fill(1),
      salt: new Uint8Array(32).fill(2),
      nonce: new Uint8Array(12).fill(3),
      scheme: 'https',
      contentLength: 512,
      filename: 'photo.png',
    };
    xmtpMock.sendAttachment.mockResolvedValueOnce({
      id: 'published-attachment',
      conversationId: 'c1',
      senderAddress: 'self-inbox',
      content: 'photo.png',
      sentAt: Date.now(),
      isLocalFallback: false,
      remoteAttachment,
    });
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    const file = {
      name: 'photo.png',
      type: 'image/png',
      size: fileBytes.byteLength,
      arrayBuffer: async () => fileBytes.buffer,
    } as File;
    await act(async () => {
      await api!.sendAttachment('c1', file);
    });

    expect(mockStorage.reconcilePublishedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        optimisticMessageId: expect.stringMatching(/^msg_/),
        message: expect.objectContaining({
          id: 'published-attachment',
          status: 'sent',
        }),
        attachment: expect.objectContaining({
          id: 'att_published-attachment',
          messageId: 'published-attachment',
          storageRef: remoteAttachment.url,
          evictable: true,
        }),
        data: fileBytes.buffer,
        remoteEnvelope: expect.objectContaining({
          id: 'att_published-attachment',
          messageId: 'published-attachment',
          conversationId: 'c1',
        }),
      }),
    );
    expect(mockStorage.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not mark a published image failed when local cache reconciliation fails', async () => {
    const fileBytes = pngBytes();
    xmtpMock.sendAttachment.mockResolvedValueOnce({
      id: 'published-with-cache-error',
      conversationId: 'c1',
      senderAddress: 'self-inbox',
      content: 'photo.png',
      sentAt: Date.now(),
      isLocalFallback: false,
    });
    mockStorage.reconcilePublishedAttachment.mockRejectedValueOnce(
      new Error('IndexedDB quota exceeded'),
    );
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    const file = {
      name: 'photo.png',
      type: 'image/png',
      size: fileBytes.byteLength,
      arrayBuffer: async () => fileBytes.buffer,
    } as File;
    await act(async () => {
      await api!.sendAttachment('c1', file);
    });

    expect(useMessageStore.getState().messagesByConversation.c1).toEqual([
      expect.objectContaining({
        id: 'published-with-cache-error',
        status: 'sent',
      }),
    ]);
    expect(mockStorage.updateMessageStatus).not.toHaveBeenCalledWith(
      'published-with-cache-error',
      'failed',
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui:toast',
        detail: 'Image sent, but its local cache could not be updated.',
      }),
    );
    dispatchSpy.mockRestore();
  });

  it('stores an incoming remote attachment descriptor without downloading it', async () => {
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    const remoteAttachment = {
      url: 'https://example.ipfscdn.io/photo.enc',
      contentDigest: 'digest',
      secret: new Uint8Array(32).fill(1),
      salt: new Uint8Array(32).fill(2),
      nonce: new Uint8Array(12).fill(3),
      scheme: 'https',
      contentLength: 512,
      filename: 'photo.png',
    };

    await act(async () => {
      await api!.receiveMessage('c1', {
        id: 'incoming-attachment-1',
        conversationId: 'c1',
        senderAddress: 'peer-inbox',
        content: 'photo.png',
        remoteAttachment,
        sentAt: Date.now(),
      });
    });

    expect(xmtpMock.loadRemoteAttachment).not.toHaveBeenCalled();
    expect(mockStorage.putAttachment).not.toHaveBeenCalled();
    expect(mockStorage.putAttachmentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att_incoming-attachment-1',
        cacheState: 'metadata',
        sourceHost: 'example.ipfscdn.io',
      }),
    );
    expect(mockStorage.putRemoteAttachmentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att_incoming-attachment-1',
        conversationId: 'c1',
        url: remoteAttachment.url,
      }),
    );
  });

  it('makes a validated legacy cache evictable only after restoring its envelope', async () => {
    const legacyBytes = pngBytes().buffer as ArrayBuffer;
    mockStorage.getAttachmentMetadata.mockResolvedValue({
      id: 'att_legacy-attachment',
      messageId: 'legacy-attachment',
      filename: 'photo.png',
      mimeType: 'image/png',
      size: legacyBytes.byteLength,
      storageRef: 'https://example.ipfscdn.io/photo.enc',
      sha256: 'digest',
    });
    mockStorage.getAttachmentData.mockResolvedValue(legacyBytes);

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await act(async () => {
      await api!.receiveMessage('c1', {
        id: 'legacy-attachment',
        conversationId: 'c1',
        senderAddress: 'peer-inbox',
        content: 'photo.png',
        remoteAttachment: {
          url: 'https://example.ipfscdn.io/photo.enc',
          contentDigest: 'digest',
          secret: new Uint8Array(32).fill(1),
          salt: new Uint8Array(32).fill(2),
          nonce: new Uint8Array(12).fill(3),
          scheme: 'https',
          contentLength: 512,
          filename: 'photo.png',
        },
        sentAt: Date.now(),
      });
    });

    expect(mockStorage.putRemoteAttachmentEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      mockStorage.putAttachmentMetadata.mock.invocationCallOrder[0],
    );
    expect(mockStorage.putAttachmentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att_legacy-attachment',
        cacheState: 'cached',
        cachedBytes: legacyBytes.byteLength,
        evictable: true,
      }),
    );
  });

  it('requires explicit approval before loading from an unknown host', async () => {
    const metadata: Attachment = {
      id: 'att-unknown',
      messageId: 'message-unknown',
      filename: 'photo.png',
      mimeType: 'application/octet-stream',
      size: 512,
      storageRef: 'https://media.example.net/photo.enc',
      sourceHost: 'media.example.net',
      cacheState: 'metadata',
      evictable: true,
    };
    const envelope: StoredRemoteAttachmentEnvelope = {
      id: metadata.id,
      messageId: metadata.messageId,
      conversationId: 'c1',
      url: metadata.storageRef!,
      contentDigest: 'digest',
      secret: new Uint8Array(32).fill(1),
      salt: new Uint8Array(32).fill(2),
      nonce: new Uint8Array(12).fill(3),
      scheme: 'https',
      contentLength: 512,
      filename: metadata.filename,
    };
    mockStorage.getAttachmentMetadata.mockResolvedValue(metadata);
    mockStorage.getRemoteAttachmentEnvelope.mockResolvedValue(envelope);

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await expect(api!.loadAttachment('c1', metadata.id)).rejects.toThrow(
      'requires approval for media.example.net',
    );
    expect(xmtpMock.loadRemoteAttachment).not.toHaveBeenCalled();
  });

  it('publishes explicit XMTP consent changes', async () => {
    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await api!.allowConversation('c1');
    await api!.denyConversation('c1');

    expect(xmtpMock.updateConversationConsentState).toHaveBeenNthCalledWith(
      1, 'c1', ConsentState.Allowed,
    );
    expect(xmtpMock.updateConversationConsentState).toHaveBeenNthCalledWith(
      2, 'c1', ConsentState.Denied,
    );
  });

  it('clears the matching local contact block when allowing from an attachment', async () => {
    const peerAddress = '0x1111111111111111111111111111111111111111';
    const unblockContact = vi.fn(async () => undefined);
    useContactStore.setState((state) => ({
      ...state,
      contacts: [
        {
          inboxId: 'peer-inbox',
          name: 'Peer',
          addresses: [peerAddress],
          createdAt: 1,
          isBlocked: true,
        },
      ],
      unblockContact,
    }));

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await api!.allowConversation('c1', true);

    expect(xmtpMock.updateConversationConsentState).toHaveBeenCalledWith(
      'c1',
      ConsentState.Allowed,
    );
    expect(unblockContact).toHaveBeenCalledWith('peer-inbox');
  });

  it('does not clear a group member block when allowing a group attachment', async () => {
    const peerAddress = '0x1111111111111111111111111111111111111111';
    const unblockContact = vi.fn(async () => undefined);
    useConversationStore.setState((state) => ({
      ...state,
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        isGroup: true,
      })),
    }));
    useContactStore.setState((state) => ({
      ...state,
      contacts: [
        {
          inboxId: 'peer-inbox',
          name: 'Peer',
          addresses: [peerAddress],
          createdAt: 1,
          isBlocked: true,
        },
      ],
      unblockContact,
    }));

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    await api!.allowConversation('c1', true);

    expect(xmtpMock.updateConversationConsentState).toHaveBeenCalledWith(
      'c1',
      ConsentState.Allowed,
    );
    expect(unblockContact).not.toHaveBeenCalled();
  });

  it('loads and caches an approved attachment under the per-inbox quota', async () => {
    const metadata: Attachment = {
      id: 'att-trusted',
      messageId: 'message-trusted',
      filename: 'photo.png',
      mimeType: 'application/octet-stream',
      size: 512,
      storageRef: 'https://example.ipfscdn.io/photo.enc',
      sourceHost: 'example.ipfscdn.io',
      cacheState: 'metadata',
      evictable: true,
    };
    const envelope: StoredRemoteAttachmentEnvelope = {
      id: metadata.id,
      messageId: metadata.messageId,
      conversationId: 'c1',
      url: metadata.storageRef!,
      contentDigest: 'digest',
      secret: new Uint8Array(32).fill(1),
      salt: new Uint8Array(32).fill(2),
      nonce: new Uint8Array(12).fill(3),
      scheme: 'https',
      contentLength: 512,
      filename: metadata.filename,
    };
    mockStorage.getAttachmentMetadata.mockResolvedValue(metadata);
    mockStorage.getRemoteAttachmentEnvelope.mockResolvedValue(envelope);

    let api: ReturnType<typeof useMessages> | null = null;
    await act(async () => {
      render(<Harness onReady={(value) => (api = value)} />);
    });

    const result = await api!.loadAttachment('c1', metadata.id);

    expect(xmtpMock.loadRemoteAttachment).toHaveBeenCalledWith('c1', envelope, 'self-inbox');
    expect(mockStorage.cacheRemoteAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: metadata.id,
        mimeType: 'image/png',
        cacheState: 'cached',
        cachedBytes: 3,
      }),
      result.data,
      100 * 1024 * 1024,
    );
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
