/**
 * Messages state store
 */

import { create } from 'zustand';
import type { Message } from '@/types';

const sortMessagesBySentAt = (messages: Message[]): Message[] =>
  [...messages].sort((a, b) => a.sentAt - b.sentAt);

interface MessageState {
  // State - messages grouped by conversation ID
  messagesByConversation: Record<string, Message[]>;
  loadingConversations: Record<string, boolean>;
  loadedConversations: Record<string, boolean>;
  isSending: boolean;

  // Actions
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  removeMessage: (messageId: string) => void;
  setLoading: (conversationId: string, loading: boolean) => void;
  setSending: (sending: boolean) => void;
  clearMessages: (conversationId: string) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  // Initial state
  messagesByConversation: {},
  loadingConversations: {},
  loadedConversations: {},
  isSending: false,

  // Actions
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: sortMessagesBySentAt(messages),
      },
      loadedConversations: {
        ...state.loadedConversations,
        [conversationId]: true,
      },
    })),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] || [];
      // De-dup on message ID (authoritative)
      const already = existing.find((m) => m.id === message.id);
      const next = already
        ? existing.map((m) => (m.id === message.id ? { ...m, ...message } : m))
        : [...existing, message];
      const updated = sortMessagesBySentAt(next);
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updated,
        },
        loadedConversations: {
          ...state.loadedConversations,
          [conversationId]: true,
        },
      };
    }),

  updateMessage: (messageId, updates) =>
    set((state) => {
      const newMessages: Record<string, Message[]> = {};
      
      for (const [convId, messages] of Object.entries(state.messagesByConversation)) {
        newMessages[convId] = messages.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        );
      }

      return { messagesByConversation: newMessages };
    }),

  removeMessage: (messageId) =>
    set((state) => {
      const newMessages: Record<string, Message[]> = {};

      for (const [convId, messages] of Object.entries(state.messagesByConversation)) {
        newMessages[convId] = messages.filter((m) => m.id !== messageId);
      }

      return { messagesByConversation: newMessages };
    }),

  setLoading: (conversationId, loading) =>
    set((state) => {
      const loadingConversations = { ...state.loadingConversations };
      if (loading) {
        loadingConversations[conversationId] = true;
      } else {
        delete loadingConversations[conversationId];
      }
      return { loadingConversations };
    }),

  setSending: (sending) => set({ isSending: sending }),

  clearMessages: (conversationId) =>
    set((state) => {
      const newMessages = { ...state.messagesByConversation };
      delete newMessages[conversationId];
      const loadingConversations = { ...state.loadingConversations };
      delete loadingConversations[conversationId];
      const loadedConversations = { ...state.loadedConversations };
      delete loadedConversations[conversationId];
      return {
        messagesByConversation: newMessages,
        loadingConversations,
        loadedConversations,
      };
    }),
}));
