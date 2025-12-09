import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useMessageStore, useAuthStore } from '@/lib/stores';
import type { Message } from '@/types';
/* eslint-disable @typescript-eslint/no-explicit-any */

const deleteMessage = vi.fn(async () => undefined);
const reactToMessage = vi.fn(async () => undefined);

vi.mock('./useMessages', () => ({
  useMessages: () => ({
    deleteMessage,
    reactToMessage,
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

describe('MessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
