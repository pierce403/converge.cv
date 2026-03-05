import { beforeEach, describe, expect, it } from 'vitest';
import { useConversationStore } from './conversation-store';
import type { Conversation } from '@/types';

const baseConversation = (id: string, overrides: Partial<Conversation> = {}): Conversation => ({
  id,
  peerId: overrides.peerId ?? id,
  lastMessageAt: overrides.lastMessageAt ?? Date.now(),
  unreadCount: 0,
  pinned: false,
  archived: false,
  createdAt: overrides.createdAt ?? Date.now(),
  ...overrides,
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

  it('dedupes addConversation by id', () => {
    const store = useConversationStore.getState();
    const older = baseConversation('same-id', { lastMessageAt: 1000, createdAt: 1000 });
    const newer = baseConversation('same-id', { lastMessageAt: 2000, createdAt: 2000 });

    store.addConversation(older);
    store.addConversation(newer);

    const conversations = useConversationStore.getState().conversations;
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('same-id');
    expect(conversations[0].lastMessageAt).toBe(2000);
  });

  it('dedupes DM conversations by peer and keeps newest non-local entry', () => {
    const store = useConversationStore.getState();
    store.setConversations([
      baseConversation('local-1', { peerId: 'peer-a', lastMessageAt: 1000 }),
      baseConversation('server-1', { peerId: 'peer-a', lastMessageAt: 900 }),
      baseConversation('server-2', { peerId: 'peer-b', lastMessageAt: 800 }),
      baseConversation('server-3', { peerId: 'peer-a', lastMessageAt: 1100 }),
    ]);

    const conversations = useConversationStore.getState().conversations;
    expect(conversations).toHaveLength(2);
    expect(conversations.find((c) => c.peerId === 'peer-a')?.id).toBe('server-3');
    expect(conversations.find((c) => c.peerId === 'peer-b')?.id).toBe('server-2');
  });
});
