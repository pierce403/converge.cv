/**
 * Conversations state store
 */

import { create } from 'zustand';
import type { Conversation } from '@/types';

const INBOX_ID_WITH_0X_REGEX = /^0x[0-9a-f]{64}$/i;

const normalizePeerKey = (conversation: Conversation): string | null => {
  if (conversation.isGroup) {
    return null;
  }
  const peerId = conversation.peerId?.trim();
  if (!peerId) {
    return null;
  }
  const lowered = peerId.toLowerCase();
  if (INBOX_ID_WITH_0X_REGEX.test(lowered)) {
    return lowered.slice(2);
  }
  return lowered;
};

const pickPreferredConversation = (a: Conversation, b: Conversation): Conversation => {
  const aLocal = a.id.startsWith('local-');
  const bLocal = b.id.startsWith('local-');
  if (aLocal !== bLocal) {
    return aLocal ? b : a;
  }

  const aLast = a.lastMessageAt || 0;
  const bLast = b.lastMessageAt || 0;
  if (aLast !== bLast) {
    return aLast >= bLast ? a : b;
  }

  const aCreated = a.createdAt || 0;
  const bCreated = b.createdAt || 0;
  if (aCreated !== bCreated) {
    return aCreated >= bCreated ? a : b;
  }

  return a.id <= b.id ? a : b;
};

const dedupeConversations = (conversations: Conversation[]): Conversation[] => {
  if (conversations.length <= 1) {
    return conversations;
  }

  const byId = new Map<string, Conversation>();
  const order: string[] = [];
  for (const conversation of conversations) {
    const existing = byId.get(conversation.id);
    if (!existing) {
      byId.set(conversation.id, conversation);
      order.push(conversation.id);
      continue;
    }
    byId.set(conversation.id, pickPreferredConversation(existing, conversation));
  }

  const result: Conversation[] = [];
  const peerToConversationId = new Map<string, string>();
  const indexByConversationId = new Map<string, number>();

  for (const id of order) {
    const conversation = byId.get(id);
    if (!conversation) {
      continue;
    }
    const peerKey = normalizePeerKey(conversation);
    if (!peerKey) {
      indexByConversationId.set(conversation.id, result.length);
      result.push(conversation);
      continue;
    }

    const existingId = peerToConversationId.get(peerKey);
    if (!existingId) {
      peerToConversationId.set(peerKey, conversation.id);
      indexByConversationId.set(conversation.id, result.length);
      result.push(conversation);
      continue;
    }

    const existingIndex = indexByConversationId.get(existingId);
    if (existingIndex === undefined) {
      peerToConversationId.set(peerKey, conversation.id);
      indexByConversationId.set(conversation.id, result.length);
      result.push(conversation);
      continue;
    }

    const current = result[existingIndex];
    const preferred = pickPreferredConversation(current, conversation);
    if (preferred.id !== current.id) {
      result[existingIndex] = preferred;
      indexByConversationId.delete(current.id);
      indexByConversationId.set(preferred.id, existingIndex);
      peerToConversationId.set(peerKey, preferred.id);
    }
  }

  return result;
};

interface ConversationState {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  incrementUnread: (id: string) => void;
  clearUnread: (id: string) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  // Initial state
  conversations: [],
  activeConversationId: null,
  isLoading: false,

  // Actions
  setConversations: (conversations) => set({ conversations: dedupeConversations(conversations) }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: dedupeConversations([conversation, ...state.conversations]),
    })),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: dedupeConversations(
        state.conversations.map((c) => (c.id === id ? { ...c, ...updates } : c))
      ),
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  setLoading: (loading) => set({ isLoading: loading }),

  incrementUnread: (id) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: c.unreadCount + 1 } : c
      ),
    })),

  clearUnread: (id) =>
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
    })),
}));
