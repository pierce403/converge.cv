/**
 * Conversations hook for managing conversation operations
 */

import { useCallback, useEffect } from 'react';
import { useConversationStore, useAuthStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type GroupDetails } from '@/lib/xmtp';
import type { Conversation } from '@/types';
import { DEFAULT_CONTACTS } from '@/lib/default-contacts';
import { getAddress } from 'viem';

const groupDetailsToConversationUpdates = (details: GroupDetails): Partial<Conversation> => {
  const memberAddresses = details.members.map((member) => member.address);
  const uniqueMembers = Array.from(new Set(memberAddresses));
  const uniqueAdmins = Array.from(new Set(details.adminAddresses));

  return {
    groupName: details.name?.trim() || undefined,
    groupImage: details.imageUrl?.trim() || undefined,
    groupDescription: details.description?.trim() || undefined,
    members: uniqueMembers,
    admins: uniqueAdmins,
  };
};

export function useConversations() {
  const conversations = useConversationStore((state) => state.conversations);
  const activeConversationId = useConversationStore((state) => state.activeConversationId);
  const isLoading = useConversationStore((state) => state.isLoading);
  const setConversations = useConversationStore((state) => state.setConversations);
  const addConversation = useConversationStore((state) => state.addConversation);
  const updateConversation = useConversationStore((state) => state.updateConversation);
  const removeConversation = useConversationStore((state) => state.removeConversation);
  const setActiveConversation = useConversationStore((state) => state.setActiveConversation);
  const setLoading = useConversationStore((state) => state.setLoading);
  const incrementUnread = useConversationStore((state) => state.incrementUnread);
  const clearUnread = useConversationStore((state) => state.clearUnread);
  const { isAuthenticated, isVaultUnlocked } = useAuthStore();

  /**
   * Load all conversations from storage
   */
  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
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

      setConversations(conversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [setConversations, setLoading]);

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
          lastMessagePreview: '',
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: Date.now(),
          isGroup: false, // Explicitly mark as DM
        };

        // Persist
        await storage.putConversation(conversation);

        // Add to store
        addConversation(conversation);

        return conversation;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        return null;
      }
    },
    [addConversation]
  );

  /**
   * Create a new group conversation
   */
  const createGroupConversation = useCallback(
    async (participantAddresses: string[], groupName?: string): Promise<Conversation | null> => {
      try {
        // Ensure current user is included in participants if not already
        const currentAddress = useAuthStore.getState().identity?.address;
        const allParticipants = currentAddress && !participantAddresses.includes(currentAddress)
          ? [currentAddress, ...participantAddresses]
          : participantAddresses;

        // Create via XMTP
        const xmtp = getXmtpClient();
        const xmtpGroupConv = await xmtp.createGroupConversation(allParticipants);

        // Create conversation object
        let conversation: Conversation = {
          id: xmtpGroupConv.id,
          peerId: xmtpGroupConv.peerId, // This will be the group ID
          topic: xmtpGroupConv.topic,
          lastMessageAt: Date.now(),
          lastMessagePreview: '',
          unreadCount: 0,
          pinned: false,
          archived: false,
          createdAt: Date.now(),
          isGroup: true, // Explicitly mark as group
          groupName: groupName || `Group with ${allParticipants.length} members`,
          members: allParticipants,
          admins: [currentAddress].filter(Boolean) as string[], // Creator is admin
        };

        // Attempt to sync authoritative group metadata from XMTP
        try {
          const details = await xmtp.fetchGroupDetails(conversation.id);
          if (details) {
            const updates = groupDetailsToConversationUpdates(details);
            conversation = { ...conversation, ...updates };
          }
        } catch (error) {
          console.warn('Failed to hydrate group metadata after creation:', error);
        }

        // Persist
        const storage = await getStorage();
        await storage.putConversation(conversation);

        // Add to store
        addConversation(conversation);

        return conversation;
      } catch (error) {
        console.error('Failed to create group conversation:', error);
        return null;
      }
    },
    [addConversation]
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
          updateConversation(conversationId, { pinned });
        }
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    [updateConversation]
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
          updateConversation(conversationId, { archived });
        }
      } catch (error) {
        console.error('Failed to toggle archive:', error);
      }
    },
    [updateConversation]
  );

  /**
   * Clear unread count
   */
  const markAsRead = useCallback(
    async (conversationId: string) => {
      try {
        const storage = await getStorage();
        await storage.updateConversationUnread(conversationId, 0);
        clearUnread(conversationId);
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    },
    [clearUnread]
  );

  /**
   * Update conversation properties and persist to storage
   */
  const updateConversationAndPersist = useCallback(
    async (conversationId: string, updates: Partial<Conversation>) => {
      try {
        const storage = await getStorage();
        const existingConversation = await storage.getConversation(conversationId);

        if (existingConversation) {
          const updatedConversation = { ...existingConversation, ...updates };
          await storage.putConversation(updatedConversation);
          updateConversation(conversationId, updatedConversation);
        }
      } catch (error) {
        console.error('Failed to update conversation and persist:', error);
      }
    },
    [updateConversation]
  );

  /**
   * Add members to a group conversation
   */
  const addMembersToGroup = useCallback(
    async (conversationId: string, newMembers: string[]) => {
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);

        if (!conversation || !conversation.isGroup) {
          return;
        }

        const existingMembers = new Set((conversation.members || []).map((member) => member.toLowerCase()));

        const normalizedCandidates = newMembers
          .map((member) => {
            try {
              return getAddress(member.trim() as `0x${string}`);
            } catch (error) {
              console.warn('Skipping invalid address while adding to group:', member, error);
              return null;
            }
          })
          .filter((value): value is `0x${string}` => Boolean(value));

        const membersToAdd = normalizedCandidates.filter(
          (member) => !existingMembers.has(member.toLowerCase())
        );

        if (membersToAdd.length === 0) {
          console.info('No new members to add for conversation', conversationId);
          return;
        }

        const xmtp = getXmtpClient();
        const details = await xmtp.addMembersToGroup(conversationId, membersToAdd);

        if (details) {
          const updates = groupDetailsToConversationUpdates(details);
          await updateConversationAndPersist(conversationId, updates);
        }
      } catch (error) {
        console.error('Failed to add members to group:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  /**
   * Remove members from a group conversation
   */
  const removeMembersFromGroup = useCallback(
    async (conversationId: string, membersToRemove: string[]) => {
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);

        if (!conversation || !conversation.isGroup) {
          return;
        }

        const normalizedAddresses = membersToRemove
          .map((member) => {
            try {
              return getAddress(member.trim() as `0x${string}`);
            } catch {
              return member;
            }
          })
          .filter((value) => Boolean(value));

        if (normalizedAddresses.length === 0) {
          return;
        }

        const xmtp = getXmtpClient();
        const details = await xmtp.removeMembersFromGroup(conversationId, normalizedAddresses);

        if (details) {
          const updates = groupDetailsToConversationUpdates(details);
          await updateConversationAndPersist(conversationId, updates);
        }
      } catch (error) {
        console.error('Failed to remove members from group:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  /**
   * Promote a member to admin in a group conversation
   */
  const promoteMemberToAdmin = useCallback(
    async (conversationId: string, memberAddress: string) => {
      try {
        const normalizedAddress = getAddress(memberAddress as `0x${string}`);
        const xmtp = getXmtpClient();
        const details = await xmtp.promoteMemberToAdmin(conversationId, normalizedAddress);

        if (details) {
          const updates = groupDetailsToConversationUpdates(details);
          await updateConversationAndPersist(conversationId, updates);
        }
      } catch (error) {
        console.error('Failed to promote member to admin:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  /**
   * Demote an admin to member in a group conversation
   */
  const demoteAdminToMember = useCallback(
    async (conversationId: string, adminAddress: string) => {
      try {
        const normalizedAddress = getAddress(adminAddress as `0x${string}`);
        const xmtp = getXmtpClient();
        const details = await xmtp.demoteAdminToMember(conversationId, normalizedAddress);

        if (details) {
          const updates = groupDetailsToConversationUpdates(details);
          await updateConversationAndPersist(conversationId, updates);
        }
      } catch (error) {
        console.error('Failed to demote admin to member:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  /**
   * Refresh group metadata from XMTP for a specific conversation
   */
  const refreshGroupDetails = useCallback(
    async (conversationId: string): Promise<Partial<Conversation> | null> => {
      try {
        const xmtp = getXmtpClient();
        const details = await xmtp.fetchGroupDetails(conversationId);
        if (!details) {
          return null;
        }
        const updates = groupDetailsToConversationUpdates(details);
        await updateConversationAndPersist(conversationId, updates);
        return updates;
      } catch (error) {
        console.error('Failed to refresh group details:', error);
        return null;
      }
    },
    [updateConversationAndPersist]
  );

  /**
   * Update group metadata (name/image/description) via XMTP and persist locally
   */
  const updateGroupMetadata = useCallback(
    async (
      conversationId: string,
      updates: { groupName?: string; groupImage?: string; groupDescription?: string }
    ): Promise<Partial<Conversation> | null> => {
      try {
        const xmtp = getXmtpClient();
        const details = await xmtp.updateGroupMetadata(conversationId, {
          name: updates.groupName,
          imageUrl: updates.groupImage,
          description: updates.groupDescription,
        });

        if (!details) {
          return null;
        }

        const mergedUpdates = groupDetailsToConversationUpdates(details);
        await updateConversationAndPersist(conversationId, mergedUpdates);
        return mergedUpdates;
      } catch (error) {
        console.error('Failed to update group metadata:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  // Load conversations when authenticated and unlocked
  useEffect(() => {
    if (isAuthenticated && isVaultUnlocked) {
      loadConversations();
    }
  }, [isAuthenticated, isVaultUnlocked, loadConversations]);

  return {
    conversations,
    activeConversationId,
    isLoading,
    setActiveConversation,
    removeConversation,
    incrementUnread,
    loadConversations,
    createConversation,
    createGroupConversation,
    togglePin,
    toggleArchive,
    markAsRead,
    updateConversationAndPersist,
    updateGroupMetadata,
    addMembersToGroup,
    removeMembersFromGroup,
    promoteMemberToAdmin,
    demoteAdminToMember,
    refreshGroupDetails,
  };
}
