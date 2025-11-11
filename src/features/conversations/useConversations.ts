/**
 * Conversations hook for managing conversation operations
 */

import { useCallback, useEffect } from 'react';
import { PermissionPolicy, PermissionUpdateType } from '@xmtp/browser-sdk';
import { useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type GroupDetails } from '@/lib/xmtp';
import type { Conversation, GroupMember } from '@/types';
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

const groupDetailsToConversationUpdates = (details: GroupDetails): Partial<Conversation> => {
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

          const metadata = {
            lastSyncedAt: Date.now(),
            ...(existingContact
              ? {}
              : {
                  createdAt: Date.now(),
                  source: 'inbox' as const,
                }),
          };

          const upserted = await contactStore.upsertContactProfile({
            inboxId: canonicalInboxId,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            primaryAddress: profile.primaryAddress,
            addresses: profile.addresses,
            identities: profile.identities,
            source: 'inbox',
            metadata,
          });

          const updates: Partial<Conversation> = {};
          if (!conversation.isGroup && canonicalInboxId && conversation.peerId.toLowerCase() !== canonicalInboxId) {
            updates.peerId = canonicalInboxId;
          }

          const displayName =
            upserted.preferredName ||
            upserted.name ||
            profile.displayName ||
            profile.primaryAddress ||
            canonicalInboxId;
          if (displayName && conversation.displayName !== displayName) {
            updates.displayName = displayName;
          }

          const avatar = upserted.preferredAvatar || upserted.avatar || profile.avatarUrl;
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

      // Cleanup: remove self-DMs and dedupe by canonical inboxId
      try {
        const xmtp = getXmtpClient();
        const isXmtpConnected = xmtp.isConnected();
        const myInbox = xmtp.getInboxId()?.toLowerCase() || useAuthStore.getState().identity?.inboxId?.toLowerCase();
        const myAddr = useAuthStore.getState().identity?.address?.toLowerCase();
        const byPeer: Map<string, Conversation> = new Map();
        const toDelete: string[] = [];
        for (const c of conversations) {
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
            } catch (e) {
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
            try { await storage.deleteConversation(id); } catch (e) { /* ignore */ }
          }
          conversations = await storage.listConversations({ archived: false });
        }
      } catch (e) {
        // non-fatal cleanup
      }

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

        // Ensure a default contact exists: deanpierce.eth (unless the current user is that ENS)
        try {
          const me = useAuthStore.getState().identity;
          const myName = me?.displayName?.toLowerCase?.();
          if (myName !== 'deanpierce.eth') {
            const contactStore = useContactStore.getState();
            const existsByInbox = contactStore.getContactByInboxId('deanpierce.eth');
            const existsByAddr = contactStore.getContactByAddress('deanpierce.eth');
            if (!existsByInbox && !existsByAddr) {
              await contactStore.upsertContactProfile({
                inboxId: 'deanpierce.eth',
                displayName: 'deanpierce.eth',
                source: 'inbox',
                // TS: metadata is a free-form Partial<Contact>; keep it minimal
                metadata: { createdAt: Date.now(), isInboxOnly: true } as unknown as Record<string, unknown>,
              });
            }
          }
        } catch (e) {
          // non-fatal
        }
      }

      setConversations(conversations);
      void ensureConversationProfiles(conversations);
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

        // Create conversation object
        const conversation: Conversation = {
          id: xmtpConv.id,
          peerId: inboxKey,
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
      } catch (error) {
        console.error('Failed to toggle mute:', error);
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
    async (conversationId: string, deleteForAll = false): Promise<void> => {
      const storage = await getStorage();
      const conversation = await storage.getConversation(conversationId);
      const meInbox = useAuthStore.getState().identity?.inboxId;
      const meAddr = useAuthStore.getState().identity?.address;
      const normalizedInbox = typeof meInbox === 'string' ? meInbox.trim() : '';
      const normalizedAddress = typeof meAddr === 'string' ? normalizeIdentifier(meAddr) : '';
      const selfIdentifiers = Array.from(
        new Set(
          [normalizedInbox, normalizedAddress].filter((value): value is string => Boolean(value))
        )
      );

      try {
        const xmtp = getXmtpClient();
        let remoteDetails: GroupDetails | null = null;
        let remoteDetailsLoaded = false;

        const loadRemoteDetails = async (): Promise<GroupDetails | null> => {
          if (remoteDetailsLoaded) {
            return remoteDetails;
          }
          remoteDetailsLoaded = true;
          try {
            remoteDetails = await xmtp.fetchGroupDetails(conversationId);
          } catch (error) {
            console.warn('[useConversations] Failed to fetch remote group details during deleteGroup:', error);
            remoteDetails = null;
          }
          return remoteDetails;
        };

        if (deleteForAll && normalizedInbox) {
          const normalizedInboxLower = normalizedInbox.toLowerCase();
          let isSuperAdmin = Boolean(
            conversation?.superAdminInboxes?.some(
              (id) => id && id.toLowerCase() === normalizedInboxLower
            )
          );

          if (!isSuperAdmin) {
            const details = await loadRemoteDetails();
            if (details) {
              isSuperAdmin = details.superAdminInboxes.some(
                (id) => id && id.toLowerCase() === normalizedInboxLower
              );
            }
          }

          if (isSuperAdmin) {
            const candidates = new Set<string>();
            const addCandidate = (value?: string | null) => {
              if (!value) return;
              const trimmed = value.trim();
              if (trimmed) {
                candidates.add(trimmed);
              }
            };

            (conversation?.memberInboxes || []).forEach((id) => addCandidate(id));
            (conversation?.members || []).forEach((id) => {
              if (id) {
                candidates.add(normalizeIdentifier(id));
              }
            });

            if (candidates.size === 0) {
              const details = await loadRemoteDetails();
              details?.members.forEach((member) => {
                addCandidate(member.inboxId);
                if (member.address) {
                  candidates.add(normalizeIdentifier(member.address));
                }
              });
            }

            const allTargets = Array.from(candidates).filter(Boolean);
            if (allTargets.length) {
              try {
                await xmtp.removeMembersFromGroup(conversationId, allTargets);
              } catch (error) {
                console.warn('[useConversations] Failed to remove all members while deleting group:', error);
              }
            }
          }
        }

        if (selfIdentifiers.length) {
          try {
            await xmtp.removeMembersFromGroup(conversationId, selfIdentifiers);
          } catch (error) {
            console.warn('[useConversations] Failed to leave group on XMTP:', error);
          }
        }
      } catch (error) {
        console.warn('[useConversations] Failed to process group deletion on XMTP:', error);
      }

      // Purge local conversation and its messages regardless of network outcome
      try { await storage.deleteConversation(conversationId); } catch (_e) { void 0; }
      removeConversation(conversationId);
      try { await storage.vacuum(); } catch (_e) { void 0; }
    },
    [removeConversation],
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
