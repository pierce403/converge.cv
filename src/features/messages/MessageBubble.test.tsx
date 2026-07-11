import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useMessageStore, useAuthStore } from '@/lib/stores';
import type { Attachment, Message } from '@/types';
/* eslint-disable @typescript-eslint/no-explicit-any */

const mocks = vi.hoisted(() => ({
  deleteMessage: vi.fn(async () => undefined),
  reactToMessage: vi.fn(async () => undefined),
  allowConversation: vi.fn(async () => undefined),
  loadAttachment: vi.fn(),
  getAttachmentMetadata: vi.fn(),
  getAttachmentData: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:attachment-preview'),
  revokeObjectURL: vi.fn(),
}));

vi.mock('./useMessages', () => ({
  useMessages: () => ({
    deleteMessage: mocks.deleteMessage,
    reactToMessage: mocks.reactToMessage,
    allowConversation: mocks.allowConversation,
    loadAttachment: mocks.loadAttachment,
  }),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: async () => ({
    getAttachmentMetadata: mocks.getAttachmentMetadata,
    getAttachmentData: mocks.getAttachmentData,
  }),
}));

vi.mock('./MessageActionsModal', () => ({
  MessageActionsModal: ({ open, onCopy, onDelete, onReply }: any) =>
    open ? (
      <div data-testid="actions">
        <button onClick={onReply}>Reply</button>
        <button onClick={onCopy}>Copy</button>
        <button onClick={onDelete}>Delete</button>
      </div>
    ) : null,
}));

function attachmentMessage(id = 'attachment-message'): Message {
  return {
    id,
    conversationId: 'attachment-conversation',
    sender: '0xpeer',
    sentAt: Date.now(),
    body: 'photo.png',
    type: 'attachment',
    status: 'sent',
    reactions: [],
    attachmentId: `att_${id}`,
  };
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

function remoteAttachmentMetadata(
  message: Message,
  overrides: Partial<Attachment> = {}
): Attachment {
  return {
    id: message.attachmentId!,
    messageId: message.id,
    filename: 'photo.png',
    mimeType: 'application/octet-stream',
    size: 1024,
    storageRef: 'https://gateway.ipfscdn.io/ipfs/example',
    sourceHost: 'gateway.ipfscdn.io',
    cacheState: 'metadata',
    evictable: true,
    ...overrides,
  };
}

function installIntersectionObserver() {
  let callback: IntersectionObserverCallback | null = null;
  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];

    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback;
    }

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  return {
    wasCreated: () => callback !== null,
    notifyVisible: () => {
      if (!callback) throw new Error('Attachment was not observed');
      const observer = {} as IntersectionObserver;
      callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    },
  };
}

describe('MessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAttachmentMetadata.mockResolvedValue(undefined);
    mocks.getAttachmentData.mockResolvedValue(undefined);
    mocks.loadAttachment.mockRejectedValue(new Error('Unexpected attachment download'));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
    vi.stubGlobal('IntersectionObserver', undefined);
    useMessageStore.setState({
      messagesByConversation: {},
      loadingConversations: {},
      loadedConversations: {},
      isSending: false,
    });
    useAuthStore.setState({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    });
    // @ts-expect-error - stub clipboard for tests
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders inline replies and linkifies message bodies', () => {
    const replyTarget: Message = {
      id: 'm1',
      conversationId: 'c1',
      sender: '0xsender',
      sentAt: Date.now() - 1000,
      body: 'Original body',
      type: 'text',
      status: 'delivered',
      reactions: [],
    };
    useMessageStore.setState({
      messagesByConversation: { c1: [replyTarget] },
      loadingConversations: {},
      loadedConversations: { c1: true },
      isSending: false,
    });

    const message: Message = {
      id: 'm2',
      conversationId: 'c1',
      sender: '0xpeer',
      sentAt: Date.now(),
      body: 'Check https://example.com now',
      type: 'text',
      status: 'sent',
      reactions: [],
      replyTo: 'm1',
    };

    render(
      <MessageBubble
        message={message}
        onReplyRequest={vi.fn()}
        senderInfo={{ displayName: 'Alice' }}
        showSenderLabel
      />
    );

    expect(screen.getByText('Replying to')).toBeInTheDocument();
    expect(screen.getByText('Original body')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('groups reactions and shows outbound delivery state', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isVaultUnlocked: true,
      identity: {
        address: '0xabc',
        publicKey: '0xpub',
        createdAt: Date.now(),
        inboxId: '0xinbox',
      },
      vaultSecrets: null,
    });

    const message: Message = {
      id: 'm3',
      conversationId: 'c2',
      sender: '0xabc',
      sentAt: Date.now(),
      body: 'Sent message',
      type: 'text',
      status: 'delivered',
      reactions: [
        { emoji: '🔥', sender: 'a', timestamp: 1 },
        { emoji: '🔥', sender: 'b', timestamp: 2 },
        { emoji: '👀', sender: 'c', timestamp: 3 },
      ],
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText('🔥')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('👀')).toBeInTheDocument();
    expect(screen.getByText('✓✓')).toBeInTheDocument();
  });

  it('opens actions on long-press and copies text', async () => {
    vi.useFakeTimers();

    const message: Message = {
      id: 'm4',
      conversationId: 'c3',
      sender: '0xpeer',
      sentAt: Date.now(),
      body: 'Hold to open actions',
      type: 'text',
      status: 'pending',
      reactions: [],
    };

    render(<MessageBubble message={message} />);

    const textNode = screen.getByText('Hold to open actions');
    await act(async () => {
      fireEvent.pointerDown(textNode);
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByTestId('actions')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hold to open actions');
  });

  it('renders cached safe raster bytes without exposing a blob navigation link', async () => {
    const message = attachmentMessage('cached-raster');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(message, {
        mimeType: 'image/png',
        cacheState: 'cached',
      })
    );
    mocks.getAttachmentData.mockResolvedValue(pngBytes().buffer);

    const { unmount } = render(<MessageBubble message={message} />);

    const image = await screen.findByRole('img', { name: 'photo.png' });
    expect(image).toHaveAttribute('src', 'blob:attachment-preview');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(mocks.loadAttachment).not.toHaveBeenCalled();

    unmount();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:attachment-preview');
  });

  it('requires an explicit hostname-labelled action for an untrusted host', async () => {
    const observer = installIntersectionObserver();
    const message = attachmentMessage('unknown-host');
    const metadata = remoteAttachmentMetadata(message, {
      storageRef: 'https://media.example.net/attachment',
      sourceHost: 'media.example.net',
    });
    const downloaded = {
      ...metadata,
      mimeType: 'image/png',
      cacheState: 'cached' as const,
    };
    const data = pngBytes().buffer;
    mocks.getAttachmentMetadata.mockResolvedValue(metadata);
    mocks.loadAttachment.mockResolvedValue({ attachment: downloaded, data });

    render(<MessageBubble message={message} />);

    const button = await screen.findByRole('button', {
      name: 'Load image from media.example.net',
    });
    expect(observer.wasCreated()).toBe(false);
    expect(mocks.loadAttachment).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => {
      expect(mocks.loadAttachment).toHaveBeenCalledWith(
        message.conversationId,
        message.attachmentId,
        { allowUntrusted: true }
      );
    });
  });

  it('auto-loads a trusted host only after the bubble becomes visible', async () => {
    const { notifyVisible } = installIntersectionObserver();
    const message = attachmentMessage('trusted-host');
    const metadata = remoteAttachmentMetadata(message);
    const downloaded = {
      ...metadata,
      mimeType: 'image/png',
      cacheState: 'cached' as const,
    };
    const data = pngBytes().buffer;
    mocks.getAttachmentMetadata.mockResolvedValue(metadata);
    mocks.loadAttachment.mockResolvedValue({ attachment: downloaded, data });

    render(<MessageBubble message={message} />);

    expect(await screen.findByText('Image loads when visible.')).toBeInTheDocument();
    expect(mocks.loadAttachment).not.toHaveBeenCalled();

    await act(async () => notifyVisible());
    await waitFor(() => {
      expect(mocks.loadAttachment).toHaveBeenCalledWith(
        message.conversationId,
        message.attachmentId,
        { allowUntrusted: false }
      );
    });
  });

  it('does not auto-load when IntersectionObserver is unavailable', async () => {
    const message = attachmentMessage('no-observer');
    const metadata = remoteAttachmentMetadata(message);
    mocks.getAttachmentMetadata.mockResolvedValue(metadata);
    mocks.loadAttachment.mockResolvedValue({
      attachment: { ...metadata, mimeType: 'image/png', cacheState: 'cached' },
      data: pngBytes().buffer,
    });

    render(<MessageBubble message={message} />);

    const button = await screen.findByRole('button', { name: 'Load image' });
    expect(mocks.loadAttachment).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.loadAttachment).toHaveBeenCalledTimes(1));
  });

  it('shows blocked and consent states without starting a download', async () => {
    const blockedMessage = attachmentMessage('blocked');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(blockedMessage, {
        cacheState: 'blocked',
        failureReason: 'Remote URL is unsafe',
      })
    );

    const { unmount } = render(<MessageBubble message={blockedMessage} />);
    expect(await screen.findByText('Image blocked for safety.')).toBeInTheDocument();
    expect(mocks.loadAttachment).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /image/i })).not.toBeInTheDocument();
    unmount();

    const consentMessage = attachmentMessage('consent');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(consentMessage, {
        cacheState: 'failed',
        failureReason: 'Accept this conversation before loading attachments.',
      })
    );
    render(<MessageBubble message={consentMessage} />);

    expect(
      await screen.findByText('Accept this conversation before loading images.')
    ).toBeInTheDocument();
    const retry = screen.getByRole('button', {
      name: 'Accept conversation and load image',
    });
    expect(mocks.loadAttachment).not.toHaveBeenCalled();
    const consentMetadata = remoteAttachmentMetadata(consentMessage, {
      mimeType: 'image/png',
      cacheState: 'cached',
    });
    mocks.loadAttachment.mockResolvedValue({
      attachment: consentMetadata,
      data: pngBytes().buffer,
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(mocks.allowConversation).toHaveBeenCalledWith(
        consentMessage.conversationId,
        true,
      );
      expect(mocks.loadAttachment).toHaveBeenCalledTimes(1);
    });
  });

  it('labels denied attachment consent as an unblock action', async () => {
    const message = attachmentMessage('denied-consent');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(message, {
        cacheState: 'failed',
        failureReason: 'Attachments are blocked for this conversation.',
      })
    );

    render(<MessageBubble message={message} />);

    expect(await screen.findByText('Images are blocked for this conversation.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Unblock conversation and load image' })
    ).toBeInTheDocument();
  });

  it('does not create a preview URL for cached active image content', async () => {
    const message = attachmentMessage('svg');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(message, {
        mimeType: 'image/svg+xml',
        cacheState: 'cached',
      })
    );
    mocks.getAttachmentData.mockResolvedValue(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer
    );

    render(<MessageBubble message={message} />);

    expect(await screen.findByText('Unsupported attachment type.')).toBeInTheDocument();
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('revalidates legacy cached bytes before creating a preview URL', async () => {
    const message = attachmentMessage('legacy-spoofed-png');
    mocks.getAttachmentMetadata.mockResolvedValue(
      remoteAttachmentMetadata(message, {
        mimeType: 'image/png',
        cacheState: undefined,
      })
    );
    mocks.getAttachmentData.mockResolvedValue(
      new TextEncoder().encode('<html>not a png</html>').buffer
    );

    render(<MessageBubble message={message} />);

    expect(await screen.findByText('Image blocked for safety.')).toBeInTheDocument();
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
