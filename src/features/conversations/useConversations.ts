/**
 * Conversations hook for managing conversation operations
 */

import { useCallback, useEffect } from 'react';
import { useConversationStore, useAuthStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import type { Conversation } from '@/types';
import { DEFAULT_CONTACTS } from '@/lib/default-contacts';

export function useConversations() {
  const conversationStore = useConversationStore();
  const { isAuthenticated, isVaultUnlocked } = useAuthStore();

  /**
   * Load all conversations from storage
   */
  const loadConversations = useCallback(async () => {
    try {
      conversationStore.setLoading(true);
      const storage = await getStorage();
      let conversations = await storage.listConversations({ archived: false });

      if (conversations.length === 0) {
        const now = Date.now();
        const seededConversations: Conversation[] = [];

        for (const [index, contact] of DEFAULT_CONTACTS.entries()) {
          const existing = conversations.find(
            (conversation) =>
              conversation.peerId.toLowerCase() === contact.address.toLowerCase()
          );

          if (existing) {
            continue;
          }

          const timestamp = now - index * 5 * 60 * 1000;
          const seededConversation: Conversation = {
            id: `default-${contact.address}`,
            peerId: contact.address,
            topic: `default:${contact.address}`,
            lastMessageAt: timestamp,
            lastMessagePreview: contact.description,
            unreadCount: 0,
            pinned: index < 2,
            archived: false,
            createdAt: timestamp,
          };

          await storage.putConversation(seededConversation);
          seededConversations.push(seededConversation);
        }

        if (seededConversations.length > 0) {
          console.info(
            `Seeded ${seededConversations.length} default conversations`,
            seededConversations.map((conversation) => conversation.peerId)
          );
          conversations = await storage.listConversations({ archived: false });
        }
      }

      conversationStore.setConversations(conversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      conversationStore.setLoading(false);
    }
  }, [conversationStore]);

  /**
   * Create a new conversation
   */
  const createConversation = useCallback(
    async (peerAddress: string): Promise<Conversation | null> => {
      try {
        // Check if conversation already exists
        const storage = await getStorage();
        const existing = await storage.listConversations();
        const found = existing.find((c) => c.peerId === peerAddress);

        if (found) {
          return found;
        }

        // Create via XMTP
        const xmtp = getXmtpClient();
        const xmtpConv = await xmtp.createConversation(peerAddress);

        // Create conversation object
        const conversation: Conversation = {
          id: xmtpConv.id,
          peerId: peerAddress,
          topic: xmtpConv.topic,
          lastMessageAt: Date.now(),
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: Date.now(),
        };

        // Persist
        await storage.putConversation(conversation);

        // Add to store
        conversationStore.addConversation(conversation);

        return conversation;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        return null;
      }
    },
    [conversationStore]
  );

  /**
   * Pin/unpin a conversation
   */
  const togglePin = useCallback(
    async (conversationId: string) => {
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);

        if (conversation) {
          const pinned = !conversation.pinned;
          await storage.putConversation({ ...conversation, pinned });
          conversationStore.updateConversation(conversationId, { pinned });
        }
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    [conversationStore]
  );

  /**
   * Archive/unarchive a conversation
   */
  const toggleArchive = useCallback(
    async (conversationId: string) => {
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);

        if (conversation) {
          const archived = !conversation.archived;
          await storage.putConversation({ ...conversation, archived });
          conversationStore.updateConversation(conversationId, { archived });
        }
      } catch (error) {
        console.error('Failed to toggle archive:', error);
      }
    },
    [conversationStore]
  );

  /**
   * Clear unread count
   */
  const markAsRead = useCallback(
    async (conversationId: string) => {
      try {
        const storage = await getStorage();
        await storage.updateConversationUnread(conversationId, 0);
        conversationStore.clearUnread(conversationId);
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    },
    [conversationStore]
  );

  // Load conversations when authenticated and unlocked
  useEffect(() => {
    if (isAuthenticated && isVaultUnlocked) {
      loadConversations();
    }
  }, [isAuthenticated, isVaultUnlocked, loadConversations]);

  return {
    ...conversationStore,
    loadConversations,
    createConversation,
    togglePin,
    toggleArchive,
    markAsRead,
  };
}

