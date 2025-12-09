/**
 * Conversations hook for managing conversation operations
 */

import { useCallback, useEffect } from 'react';
import { PermissionPolicy, PermissionUpdateType } from '@xmtp/browser-sdk';
import { useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type GroupDetails } from '@/lib/xmtp';
import type { Conversation, DeletedConversationRecord, GroupMember } from '@/types';
import { DEFAULT_CONTACTS } from '@/lib/default-contacts';
import { getAddress } from 'viem';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const isEthereumAddress = (value: string) => ETH_ADDRESS_REGEX.test(value.trim());

const normalizeIdentifier = (value: string): string => {
  const trimmed = value.trim();
  if (isEthereumAddress(trimmed)) {
    try {
      return getAddress(trimmed as `0x${string}`);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

export const groupDetailsToConversationUpdates = (details: GroupDetails): Partial<Conversation> => {
  const memberIdentifiers = details.members.map((member) =>
    member.address ? normalizeIdentifier(member.address) : member.inboxId
  );
  const uniqueMembers = Array.from(new Set(memberIdentifiers.filter((value) => Boolean(value))));
  const uniqueAdmins = Array.from(new Set(details.adminAddresses.map(normalizeIdentifier)));
  const memberInboxes = details.members.map((member) => member.inboxId).filter(Boolean);
  const adminInboxes = Array.from(new Set(details.adminInboxes));
  const superAdminInboxes = Array.from(new Set(details.superAdminInboxes));
  const groupMembers: GroupMember[] = details.members.map((member) => ({
    inboxId: member.inboxId,
    address: member.address ? normalizeIdentifier(member.address) : undefined,
    permissionLevel: member.permissionLevel,
    isAdmin: member.isAdmin,
    isSuperAdmin: member.isSuperAdmin,
  }));

  const updates: Partial<Conversation> = {
    members: uniqueMembers,
    admins: uniqueAdmins,
    memberInboxes,
    adminInboxes,
    superAdminInboxes,
    groupMembers,
  };
  const name = details.name?.trim();
  if (name) updates.groupName = name;
  const img = details.imageUrl?.trim();
  if (img) updates.groupImage = img;
  const desc = details.description?.trim();
  if (desc) updates.groupDescription = desc;
  if (details.permissions) {
    updates.groupPermissions = {
      policyType: details.permissions.policyType,
      policySet: { ...details.permissions.policySet },
    };
  }
  return updates;
};

export function useConversations() {
  const conversations = useConversationStore((state) => state.conversations);
  const activeConversationId = useConversationStore((state) => state.activeConversationId);
  const isLoading = useConversationStore((state) => state.isLoading);
  const setConversations = useConversationStore((state) => state.setConversations);
  const addConversation = useConversationStore((state) => state.addConversation);
  const updateConversation = useConversationStore((state) => state.updateConversation);
  const ensureConversationProfiles = useCallback(
    async (items: Conversation[]) => {
      if (!items.length) {
        return;
      }

      const refreshIntervalMs = 30 * 60 * 1000; // 30 minutes
      let storageInstance: Awaited<ReturnType<typeof getStorage>> | null = null;

      for (const conversation of items) {
        if (conversation.isGroup) {
          continue;
        }

        try {
          const peerIdRaw = conversation.peerId;
          const peerIdLower = peerIdRaw?.toLowerCase?.();
          if (!peerIdLower) {
            continue;
          }

          const contactStore = useContactStore.getState();
          const existingContact =
            contactStore.getContactByInboxId(peerIdLower) ??
            contactStore.getContactByAddress(peerIdLower);

          const now = Date.now();
          const lastSynced = existingContact?.lastSyncedAt ?? 0;
          const hasFreshProfile =
            existingContact?.preferredName &&
            existingContact?.preferredAvatar &&
            now - lastSynced < refreshIntervalMs;

          if (hasFreshProfile) {
            continue;
          }

          const xmtp = getXmtpClient();
          let inboxId = peerIdLower;
          if (peerIdLower.startsWith('0x')) {
            try {
              const derived = await xmtp.deriveInboxIdFromAddress(peerIdLower);
              if (derived) {
                inboxId = derived.toLowerCase();
              }
            } catch (err) {
              console.warn('[useConversations] Failed to derive inbox id from address', err);
            }
          }

          let profile = await xmtp.fetchInboxProfile(inboxId);

          // If XMTP resolved the canonical inbox id, prefer it
          const canonicalInboxId = profile.inboxId?.toLowerCase?.() ?? inboxId;
          if (canonicalInboxId !== inboxId) {
            try {
              profile = await xmtp.fetchInboxProfile(canonicalInboxId);
            } catch (err) {
              console.warn('[useConversations] Failed to refetch profile for canonical inbox id', err);
            }
          }

          const metadata = existingContact
            ? { lastSyncedAt: Date.now() }
            : undefined;

          const updatedContact = existingContact
            ? await contactStore.upsertContactProfile({
                inboxId: canonicalInboxId,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                primaryAddress: profile.primaryAddress,
                addresses: profile.addresses,
                identities: profile.identities,
                source: 'inbox',
                metadata,
              })
            : undefined;

          const updates: Partial<Conversation> = {};
          if (!conversation.isGroup && canonicalInboxId && conversation.peerId.toLowerCase() !== canonicalInboxId) {
            updates.peerId = canonicalInboxId;
          }

          const displayName =
            updatedContact?.preferredName ||
            updatedContact?.name ||
            profile.displayName ||
            profile.primaryAddress ||
            canonicalInboxId;
          if (displayName && conversation.displayName !== displayName) {
            updates.displayName = displayName;
          }

          const avatar =
            updatedContact?.preferredAvatar || updatedContact?.avatar || profile.avatarUrl;
          if (avatar && conversation.displayAvatar !== avatar) {
            updates.displayAvatar = avatar;
          }

          if (Object.keys(updates).length > 0) {
            updateConversation(conversation.id, updates);
            try {
              storageInstance = storageInstance ?? (await getStorage());
              await storageInstance.putConversation({ ...conversation, ...updates });
            } catch (err) {
              console.warn('[useConversations] Failed to persist conversation profile updates', err);
            }
          }
        } catch (error) {
          console.warn('[useConversations] Failed to ensure conversation profile', conversation.id, error);
        }
      }
    },
    [updateConversation]
  );
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

      // Remove deprecated/broken default GM Bot conversations if present
      try {
        const gmPeer = 'gm.xmtp.eth';
        const toDelete = conversations
          .filter((c) => !c.isGroup && c.peerId.toLowerCase() === gmPeer)
          .map((c) => c.id);
        if (toDelete.length) {
          for (const id of toDelete) {
            try {
              await storage.deleteConversation(id);
            } catch (e) {
              // ignore deletion failure
            }
          }
          conversations = await storage.listConversations({ archived: false });
        }
      } catch (e) {
        // ignore cleanup failure
      }

      if (conversations.length === 0) {
        const now = Date.now();
        const seededConversations: Conversation[] = [];

        for (const [index, contact] of DEFAULT_CONTACTS.entries()) {
          const normalizedCandidate = contact.address.toLowerCase();
          try {
            if (await storage.isPeerDeleted(normalizedCandidate)) {
              continue;
            }
          } catch (markerError) {
            console.warn('[useConversations] Failed to check deleted marker for default contact', contact.address, markerError);
          }
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
            lastMessageId: undefined,
            lastMessageSender: undefined,
            lastReadAt: timestamp,
            lastReadMessageId: undefined,
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

      // Fire-and-forget cleanup that may touch the network (canonicalizing inboxIds,
      // removing self-DMs, and enriching profiles). This runs in the background so
      // the UI can show locally stored conversations immediately.
      void (async () => {
        try {
          let updated = conversations;

          // Cleanup: remove self-DMs and dedupe by canonical inboxId when XMTP is available
          try {
            const xmtp = getXmtpClient();
            const isXmtpConnected = xmtp.isConnected();
            const myInbox =
              xmtp.getInboxId()?.toLowerCase() ||
              useAuthStore.getState().identity?.inboxId?.toLowerCase();
            const myAddr = useAuthStore.getState().identity?.address?.toLowerCase();
            const byPeer: Map<string, Conversation> = new Map();
            const toDelete: string[] = [];

            for (const c of updated) {
              if (!c || c.isGroup) {
                // groups unaffected
                continue;
              }
              const peerLower = c.peerId?.toLowerCase?.() || '';
              if (!peerLower) continue;
              // Skip self conversations
              if ((myInbox && peerLower === myInbox) || (myAddr && peerLower === myAddr)) {
                toDelete.push(c.id);
                continue;
              }
              let key = peerLower;
              if (isXmtpConnected && peerLower.startsWith('0x')) {
                try {
                  const inboxId = await xmtp.deriveInboxIdFromAddress(peerLower);
                  if (inboxId) key = inboxId.toLowerCase();
                } catch {
                  // ignore failures (e.g., offline or blocked); keep address as key
                }
              }
              const existing = byPeer.get(key);
              if (!existing) {
                // If we discovered a canonical inboxId but current peerId is address, update it
                if (key !== peerLower) {
                  await storage.putConversation({ ...c, peerId: key });
                  c.peerId = key;
                }
                byPeer.set(key, c);
              } else {
                // Prefer non-local, newer lastMessageAt
                const pick = (() => {
                  const a = existing;
                  const b = c;
                  const aLocal = String(a.id).startsWith('local-');
                  const bLocal = String(b.id).startsWith('local-');
                  if (aLocal !== bLocal) return aLocal ? b : a;
                  return (a.lastMessageAt || 0) >= (b.lastMessageAt || 0) ? a : b;
                })();
                const drop = pick === c ? existing : c;
                toDelete.push(drop.id);
                byPeer.set(key, pick);
              }
            }

            if (toDelete.length) {
              for (const id of toDelete) {
                try {
                  await storage.deleteConversation(id);
                } catch {
                  // ignore
                }
              }
              updated = await storage.listConversations({ archived: false });
            }
          } catch (cleanupError) {
            // non-fatal; keep whatever we already loaded
            console.warn('[useConversations] Background cleanup failed', cleanupError);
          }

          if (updated !== conversations) {
            setConversations(updated);
          }

          // Enrich with remote profiles when possible
          await ensureConversationProfiles(updated);
        } catch (backgroundError) {
          console.warn('[useConversations] Background conversation hydration failed', backgroundError);
        }
      })();
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [setConversations, setLoading, ensureConversationProfiles]);

  /**
   * Create a new conversation
   */
  const createConversation = useCallback(
    async (peerAddress: string): Promise<Conversation | null> => {
      try {
        // Check if conversation already exists
        const storage = await getStorage();
        const existing = await storage.listConversations();
        const normalizedInput = peerAddress.toLowerCase();
        const xmtp = getXmtpClient();
        let inboxKey = normalizedInput;
        if (normalizedInput.startsWith('0x')) {
          try {
            const inboxId = await xmtp.deriveInboxIdFromAddress(normalizedInput);
            if (inboxId) inboxKey = inboxId.toLowerCase();
          } catch (e) {
            // ignore
          }
        }
        const found = existing.find((c) => !c.isGroup && c.peerId.toLowerCase() === inboxKey);

        if (found) {
          return found;
        }

        // Create via XMTP
        const xmtpConv = await xmtp.createConversation(peerAddress);

        // Use the peerId from the XMTP conversation (which is the actual inbox ID)
        // instead of the local inboxKey which might just be an address
        const actualPeerId = xmtpConv.peerId?.toLowerCase() || inboxKey;

        // Fetch XMTP profile to get display name and avatar immediately
        // This ensures the contact info shows up right away in the chat and contact card
        try {
          const contactStore = useContactStore.getState();
          
          // Try to get the actual inbox ID if actualPeerId is still an address
          let finalInboxId = actualPeerId;
          if (actualPeerId.startsWith('0x')) {
            // Try one more time to resolve the inbox ID
            try {
              const resolved = await xmtp.getInboxIdFromAddress(actualPeerId);
              if (resolved && !resolved.startsWith('0x')) {
                finalInboxId = resolved.toLowerCase();
                console.log('[useConversations] ✅ Resolved inbox ID from address:', actualPeerId, '->', finalInboxId);
              }
            } catch (e) {
              console.warn('[useConversations] Failed to resolve inbox ID from address:', e);
            }
          }
          
          // Fetch profile using the resolved inbox ID (or address if resolution failed)
          const profile = await xmtp.fetchInboxProfile(finalInboxId);
          
          // Only use profile inbox ID if it's valid (not an address)
          const profileInboxId = profile.inboxId && !profile.inboxId.startsWith('0x') && profile.inboxId.length > 10
            ? profile.inboxId.toLowerCase()
            : finalInboxId;
          
          // Final check: never store an address as the inbox ID
          if (profileInboxId.startsWith('0x')) {
            console.error('[useConversations] ERROR: Cannot store contact with address as inbox ID:', profileInboxId);
            // Don't create the contact if we can't get a valid inbox ID
            // The conversation will still work, but contact info won't be available
            throw new Error('Could not resolve inbox ID for contact');
          }
          
          await contactStore.upsertContactProfile({
            inboxId: profileInboxId,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            primaryAddress: profile.primaryAddress || (normalizedInput.startsWith('0x') ? normalizedInput : undefined),
            addresses: profile.addresses || (normalizedInput.startsWith('0x') ? [normalizedInput] : []),
            identities: profile.identities || (normalizedInput.startsWith('0x')
              ? [
                  {
                    identifier: normalizedInput,
                    kind: 'Ethereum',
                    isPrimary: true,
                  },
                ]
              : []),
            source: 'inbox',
          });
          console.log('[useConversations] ✅ Fetched and stored contact profile:', {
            inboxId: profileInboxId,
            displayName: profile.displayName,
            hasAvatar: !!profile.avatarUrl,
          });
        } catch (profileError) {
          // Non-fatal - conversation creation succeeded, profile fetch can fail
          console.warn('[useConversations] Failed to fetch/store profile for new conversation (non-fatal):', profileError);
        }

        // Get profile info from the XMTP conversation (already fetched in createConversation)
        const profileDisplayName = xmtpConv.displayName;
        const profileAvatar = xmtpConv.displayAvatar;
        
        // Create conversation object
        const conversation: Conversation = {
          id: xmtpConv.id,
          peerId: actualPeerId, // Use the actual inbox ID from XMTP
          topic: xmtpConv.topic,
          displayName: profileDisplayName, // Use display name from XMTP conversation
          displayAvatar: profileAvatar, // Use avatar from XMTP conversation
          lastMessageAt: Date.now(),
          lastMessagePreview: '',
          unreadCount: 0,
          pinned: false,
          archived: false,
          lastMessageId: undefined,
          lastMessageSender: undefined,
          lastReadAt: Date.now(),
          lastReadMessageId: undefined,
          createdAt: Date.now(),
          isGroup: false, // Explicitly mark as DM
        };

        // Persist
        await storage.putConversation(conversation);
        try {
          await storage.unmarkConversationDeletion(conversation.id);
          await storage.unmarkPeerDeletion(conversation.peerId);
        } catch (cleanupError) {
          console.warn(
            '[useConversations] Failed to clear deleted conversation markers during creation:',
            cleanupError
          );
        }

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
          lastMessageId: undefined,
          lastMessageSender: undefined,
          lastReadAt: Date.now(),
          lastReadMessageId: undefined,
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
   * Mute/unmute a conversation (indefinite mute when enabling)
   */
  const toggleMute = useCallback(
    async (conversationId: string) => {
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);
        if (!conversation) return;
        const now = Date.now();
        const isMuted = Boolean(conversation.mutedUntil && conversation.mutedUntil > now);
        const mutedUntil = isMuted ? undefined : now + 365 * 24 * 60 * 60 * 1000; // ~1 year
        await storage.putConversation({ ...conversation, mutedUntil });
        updateConversation(conversationId, { mutedUntil });
        const normalizedPeer =
          typeof conversation.peerId === 'string' && conversation.peerId
            ? conversation.peerId.toLowerCase()
            : conversationId;
        if (!isMuted) {
          try {
            await storage.markConversationDeleted({
              conversationId,
              peerId: normalizedPeer,
              deletedAt: now,
              reason: 'user-muted',
            });
          } catch (markerError) {
            console.warn('[useConversations] Failed to record mute marker', markerError);
          }
        } else {
          try {
            await storage.unmarkConversationDeletion(conversationId);
            if (normalizedPeer) {
              await storage.unmarkPeerDeletion(normalizedPeer);
            }
          } catch (markerError) {
            console.warn('[useConversations] Failed to clear mute marker', markerError);
          }
        }
      } catch (error) {
        console.error('Failed to toggle mute:', error);
      }
    },
    [updateConversation],
  );

  const hideConversation = useCallback(
    async (
      conversationId: string,
      options?: { reason?: DeletedConversationRecord['reason'] }
    ): Promise<void> => {
      const now = Date.now();
      try {
        const storage = await getStorage();
        const conversation = await storage.getConversation(conversationId);
        const peerId = conversation?.peerId || conversationId;
        const normalizedPeer = typeof peerId === 'string' ? peerId.toLowerCase() : conversationId;
        try {
          await storage.markConversationDeleted({
            conversationId,
            peerId: normalizedPeer,
            deletedAt: now,
            reason: options?.reason ?? 'user-hidden',
          });
        } catch (markerError) {
          console.warn('[useConversations] Failed to record conversation hide marker', markerError);
        }

        if (!conversation) {
          return;
        }

        await storage.deleteConversation(conversationId);
        removeConversation(conversationId);
        try {
          await storage.vacuum();
        } catch (_e) { /* ignore */ }
      } catch (error) {
        console.warn('[useConversations] Failed to hide conversation:', error);
        throw error;
      }
    },
    [removeConversation],
  );


  /**
   * Clear unread count
   */
  const markAsRead = useCallback(
    async (
      conversationId: string,
      opts?: { lastReadAt?: number; lastReadMessageId?: string }
    ) => {
      try {
        const storage = await getStorage();
        const currentConversation = useConversationStore
          .getState()
          .conversations.find((c) => c.id === conversationId);
        const existingLastReadAt = currentConversation?.lastReadAt ?? 0;
        const requestedLastReadAt = opts?.lastReadAt ?? Date.now();
        const finalLastReadAt = Math.max(existingLastReadAt, requestedLastReadAt);
        const lastReadMessageId =
          opts?.lastReadMessageId ?? currentConversation?.lastReadMessageId ?? undefined;

        await storage.updateConversationReadState(conversationId, {
          unreadCount: 0,
          lastReadAt: finalLastReadAt,
          lastReadMessageId: lastReadMessageId ?? null,
        });

        clearUnread(conversationId);
        const updates: Partial<Conversation> = {
          unreadCount: 0,
          lastReadAt: finalLastReadAt,
        };
        if (lastReadMessageId !== undefined) {
          updates.lastReadMessageId = lastReadMessageId;
        }
        updateConversation(conversationId, updates);
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    },
    [clearUnread, updateConversation]
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

        const existingIdentifiers = new Set<string>();
        (conversation.members || []).forEach((m) => existingIdentifiers.add(m.toLowerCase()));
        (conversation.memberInboxes || []).forEach((m) => existingIdentifiers.add(m.toLowerCase()));

        const normalizedCandidates = newMembers
          .map((member) => member.trim())
          .filter((member) => member.length > 0)
          .map(normalizeIdentifier);

        const membersToAdd = normalizedCandidates.filter((member) => !existingIdentifiers.has(member.toLowerCase()));

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

        const normalizedEntries = membersToRemove
          .map((member) => member.trim())
          .filter((member) => member.length > 0)
          .map(normalizeIdentifier);

        if (normalizedEntries.length === 0) {
          return;
        }

        const xmtp = getXmtpClient();
        const details = await xmtp.removeMembersFromGroup(conversationId, normalizedEntries);

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
   * Delete a group for this user: leave the group on XMTP and purge local data.
   * If the user is a super admin and `deleteForAll` is true, attempt to remove all members
   * before leaving, effectively disbanding the group. Regardless, local data is deleted.
   */
  const deleteGroup = useCallback(
    async (conversationId: string): Promise<void> => {
      await hideConversation(conversationId, { reason: 'user-hidden' });
    },
    [hideConversation],
  );

  /**
   * Promote a member to admin in a group conversation
   */
  const promoteMemberToAdmin = useCallback(
    async (conversationId: string, memberAddress: string) => {
      try {
        const normalizedAddress = normalizeIdentifier(memberAddress);
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
        const normalizedAddress = normalizeIdentifier(adminAddress);
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

        // Build authoritative updates if available
        const authoritative = details ? groupDetailsToConversationUpdates(details) : {};

        // Apply optimistic fields we just set if SDK hasn't reflected them yet
        const mergedUpdates: Partial<Conversation> = {
          ...authoritative,
          groupName: updates.groupName ?? authoritative.groupName,
          groupImage: updates.groupImage ?? authoritative.groupImage,
          groupDescription: updates.groupDescription ?? authoritative.groupDescription,
        };

        await updateConversationAndPersist(conversationId, mergedUpdates);
        return mergedUpdates;
      } catch (error) {
        console.error('Failed to update group metadata:', error);
        throw error;
      }
    },
    [updateConversationAndPersist]
  );

  const updateGroupPermission = useCallback(
    async (
      conversationId: string,
      permissionType: PermissionUpdateType,
      policy: PermissionPolicy,
    ): Promise<Partial<Conversation> | null> => {
      try {
        const xmtp = getXmtpClient();
        // First attempt to update permission on the remote group
        const details = await xmtp.updateGroupPermission(conversationId, permissionType, policy);
        // Immediately re-fetch authoritative details to ensure we reflect the latest state
        const refreshed = await xmtp.fetchGroupDetails(conversationId);
        const source = refreshed || details;
        if (!source) {
          return null;
        }
        const updates = groupDetailsToConversationUpdates(source);
        await updateConversationAndPersist(conversationId, updates);
        return updates;
      } catch (error) {
        console.error('Failed to update group permission:', error);
        throw error;
      }
    },
    [updateConversationAndPersist],
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
    toggleMute,
    hideConversation,
    markAsRead,
    updateConversationAndPersist,
    updateGroupMetadata,
    updateGroupPermission,
    addMembersToGroup,
    removeMembersFromGroup,
    promoteMemberToAdmin,
    demoteAdminToMember,
    refreshGroupDetails,
    deleteGroup,
  };
}
