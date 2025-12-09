import { beforeEach, describe, expect, it } from 'vitest';
import { useMessageStore } from './message-store';
import type { Message } from '@/types';

const baseMessage = (id: string, sentAt: number): Message => ({
  id,
  conversationId: 'c1',
  sender: 'alice',
  sentAt,
  body: `msg-${id}`,
  type: 'text',
  status: 'sent',
  reactions: [],
});

describe('message store', () => {
  beforeEach(() => {
    useMessageStore.setState({
      messagesByConversation: {},
      loadingConversations: {},
      loadedConversations: {},
      isSending: false,
    });
  });

  it('sets, adds, updates, and removes messages while maintaining order', () => {
    const { setMessages, addMessage, updateMessage, removeMessage } = useMessageStore.getState();

    setMessages('c1', [baseMessage('a', 20), baseMessage('b', 10)]);
    let messages = useMessageStore.getState().messagesByConversation['c1'];
    expect(messages.map((m) => m.id)).toEqual(['b', 'a']); // sorted

    addMessage('c1', baseMessage('c', 15));
    messages = useMessageStore.getState().messagesByConversation['c1'];
    expect(messages.map((m) => m.id)).toEqual(['b', 'c', 'a']);

    updateMessage('c', { status: 'delivered' });
    const updated = useMessageStore.getState().messagesByConversation['c1'].find((m) => m.id === 'c');
    expect(updated?.status).toBe('delivered');

    removeMessage('b');
    messages = useMessageStore.getState().messagesByConversation['c1'];
    expect(messages.map((m) => m.id)).toEqual(['c', 'a']);
  });

  it('tracks loading/sending flags and clears conversation state', () => {
    const store = useMessageStore.getState();
    store.setLoading('c2', true);
    expect(useMessageStore.getState().loadingConversations['c2']).toBe(true);

    store.setLoading('c2', false);
    expect(useMessageStore.getState().loadingConversations['c2']).toBeUndefined();

    store.setSending(true);
    expect(useMessageStore.getState().isSending).toBe(true);

    store.clearMessages('c1');
    expect(useMessageStore.getState().messagesByConversation['c1']).toBeUndefined();
  });
});
