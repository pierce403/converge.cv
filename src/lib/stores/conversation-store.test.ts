import { beforeEach, describe, expect, it } from 'vitest';
import { useConversationStore } from './conversation-store';

const baseConversation = (id: string) => ({
  id,
  peerId: id,
  lastMessageAt: Date.now(),
  unreadCount: 0,
  pinned: false,
  archived: false,
  createdAt: Date.now(),
});

describe('conversation store', () => {
  beforeEach(() => {
    useConversationStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  });

  it('sets, adds, updates, removes, and tracks active conversation', () => {
    const store = useConversationStore.getState();
    store.setConversations([baseConversation('c1')]);
    expect(useConversationStore.getState().conversations).toHaveLength(1);

    store.addConversation(baseConversation('c2'));
    expect(useConversationStore.getState().conversations[0].id).toBe('c2'); // added to front

    store.updateConversation('c2', { pinned: true, lastMessagePreview: 'hi' });
    const updated = useConversationStore.getState().conversations.find((c) => c.id === 'c2');
    expect(updated?.pinned).toBe(true);
    expect(updated?.lastMessagePreview).toBe('hi');

    store.setActiveConversation('c2');
    expect(useConversationStore.getState().activeConversationId).toBe('c2');

    store.incrementUnread('c2');
    expect(useConversationStore.getState().conversations.find((c) => c.id === 'c2')?.unreadCount).toBe(1);

    store.clearUnread('c2');
    expect(useConversationStore.getState().conversations.find((c) => c.id === 'c2')?.unreadCount).toBe(0);

    store.removeConversation('c2');
    expect(useConversationStore.getState().conversations.find((c) => c.id === 'c2')).toBeUndefined();
    expect(useConversationStore.getState().activeConversationId).toBeNull();
  });
});
