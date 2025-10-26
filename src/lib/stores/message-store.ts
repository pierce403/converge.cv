/**
 * Messages state store
 */

import { create } from 'zustand';
import type { Message } from '@/types';

interface MessageState {
  // State - messages grouped by conversation ID
  messagesByConversation: Record<string, Message[]>;
  isLoading: boolean;
  isSending: boolean;

  // Actions
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  removeMessage: (messageId: string) => void;
  setLoading: (loading: boolean) => void;
  setSending: (sending: boolean) => void;
  clearMessages: (conversationId: string) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  // Initial state
  messagesByConversation: {},
  isLoading: false,
  isSending: false,

  // Actions
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: messages,
      },
    })),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] || [];
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: [...existing, message],
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

  setLoading: (loading) => set({ isLoading: loading }),

  setSending: (sending) => set({ isSending: sending }),

  clearMessages: (conversationId) =>
    set((state) => {
      const newMessages = { ...state.messagesByConversation };
      delete newMessages[conversationId];
      return { messagesByConversation: newMessages };
    }),
}));

