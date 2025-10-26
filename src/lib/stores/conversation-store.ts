/**
 * Conversations state store
 */

import { create } from 'zustand';
import type { Conversation } from '@/types';

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
  setConversations: (conversations) => set({ conversations }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...updates } : c)),
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

