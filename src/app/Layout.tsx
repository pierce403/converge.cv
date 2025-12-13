import { useCallback, useEffect, useState } from 'react';
import { useVisualViewport } from '@/lib/utils/useVisualViewport';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { DebugLogPanel } from '@/components/DebugLogPanel';
import { ToastContainer } from '@/components/ToastContainer';
import { SyncProgressBar } from '@/components/SyncProgressBar';
import { OperationProgressBar } from '@/components/OperationProgressBar';
import { useAuthStore, useConversationStore, useContactStore, useFarcasterStore, useMessageStore } from '@/lib/stores';
import { useMessages } from '@/features/messages/useMessages';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import { getResyncReadStateFor } from '@/lib/xmtp/resync-state';
import type { Conversation } from '@/types';
import type { XmtpMessage } from '@/lib/xmtp';
import type { Contact } from '@/lib/stores/contact-store';
import { InboxSwitcher } from '@/features/identity/InboxSwitcher';
import { saveLastRoute } from '@/lib/utils/route-persistence';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { PersonalizationReminderModal } from '@/components/PersonalizationReminderModal';
import { syncSelfFarcasterProfile } from '@/lib/farcaster/self';
// Do not enrich from ENS/Farcaster for avatars or names. Use XMTP network data only.


export function Layout() {
  // Sync CSS --vh and keyboard-open class with VisualViewport
  useVisualViewport();
  const location = useLocation();
  const identity = useAuthStore((state) => state.identity);
  const { addConversation, updateConversation } = useConversationStore();
  const { receiveMessage } = useMessages();
  const loadContacts = useContactStore((state) => state.loadContacts);
  const [showPersonalizationReminder, setShowPersonalizationReminder] = useState(false);
  const lastSyncedAt = useXmtpStore((state) => state.lastSyncedAt);
  const [isChecking, setIsChecking] = useState(false);

  const handleCheckInbox = async () => {
    setIsChecking(true);
    try {
      await getXmtpClient().syncConversations();
    } catch (e) {
      console.error('Failed to check inbox', e);
    } finally {
      setIsChecking(false);
    }
  };

  // Treat auto-generated labels (e.g., "Identity 0x1234…") as "missing" a real display name
  const isAutoLabel = (val?: string | null) => {
    if (!val) return true;
    const v = val.trim();
    return v.startsWith('Identity ') || v.startsWith('Wallet ');
  };
  
  const missingDisplayName = Boolean(identity && isAutoLabel(identity.displayName));
  const missingAvatar = Boolean(identity && !identity.avatar?.trim());
  
  // Only nag about display name - avatar is truly optional
  // Avatar info is still shown in the modal but we don't require it
  const shouldShowPersonalizationNag = missingDisplayName;

  // Use address-based reminder key (stable from identity creation, unlike inboxId which comes later)
  const getReminderKey = useCallback(() => {
    // Always use address - it's available immediately and doesn't change
    // Using inboxId would cause key to change mid-session when XMTP connects
    const addr = identity?.address?.toLowerCase?.();
    return addr ? `personalization-reminder:${addr}` : 'personalization-reminder';
  }, [identity?.address]);

  const readReminderPrefs = useCallback((): { lastNagAt?: number; dismissedForever?: boolean } => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return {};
    }
    try {
      const key = getReminderKey();
      const raw = window.localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as { lastNagAt?: number; dismissedForever?: boolean };
      return {
        lastNagAt: typeof parsed.lastNagAt === 'number' ? parsed.lastNagAt : undefined,
        dismissedForever: parsed.dismissedForever === true,
      };
    } catch (error) {
      console.warn('[Layout] Failed to parse personalization reminder prefs:', error);
      return {};
    }
  }, [getReminderKey]);

  const updateReminderPrefs = useCallback(
    (updates: { lastNagAt?: number; dismissedForever?: boolean }) => {
      if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return;
      }
      const existing = readReminderPrefs();
      const next = { ...existing, ...updates };
      try {
        const key = getReminderKey();
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch (error) {
        console.warn('[Layout] Failed to persist personalization reminder prefs:', error);
      }
    },
    [readReminderPrefs, getReminderKey]
  );

  useEffect(() => {
    if (!identity) {
      setShowPersonalizationReminder(false);
      return;
    }

    // Only nag if display name is missing (avatar is optional)
    if (!shouldShowPersonalizationNag) {
      setShowPersonalizationReminder(false);
      return;
    }

    const prefs = readReminderPrefs();
    if (prefs.dismissedForever) {
      setShowPersonalizationReminder(false);
      return;
    }

    const now = Date.now();
    const lastNagAt = prefs.lastNagAt ?? 0;
    // Use a short cooldown (30 seconds) to prevent re-showing immediately after saving
    // This handles race conditions during navigation/remounts
    const cooldownMs = 30_000;

    if (lastNagAt && now - lastNagAt < cooldownMs) {
      // Recently interacted with, don't show yet
      setShowPersonalizationReminder(false);
      return;
    }

    const oneDayMs = 24 * 60 * 60 * 1000;
    if (!lastNagAt || now - lastNagAt >= oneDayMs) {
      setShowPersonalizationReminder(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, shouldShowPersonalizationNag]);

  const handleRemindLater = useCallback(() => {
    updateReminderPrefs({ lastNagAt: Date.now(), dismissedForever: false });
    setShowPersonalizationReminder(false);
  }, [updateReminderPrefs]);

  const handleDismissForever = useCallback(() => {
    updateReminderPrefs({ lastNagAt: Date.now(), dismissedForever: true });
    setShowPersonalizationReminder(false);
  }, [updateReminderPrefs]);

  // Deprecated: Settings redirect from personalization reminder (inline save now available)

  // Save route for persistence across refreshes
  useEffect(() => {
    saveLastRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Best-effort: keep the current user's Farcaster identity refreshed so their own contact card
  // stays populated after reloads. This only writes Farcaster fields; it does not override
  // XMTP/locally chosen display names or avatars.
  useEffect(() => {
    const run = async () => {
      if (!identity?.address || !identity.inboxId) {
        return;
      }

      const farcasterState = useFarcasterStore.getState?.();
      const apiKey = farcasterState?.getEffectiveNeynarApiKey?.();
      if (!apiKey) {
        return;
      }

      const cooldownKey = `self-farcaster:last-check:${identity.address.toLowerCase()}`;
      try {
        const lastRaw = typeof window !== 'undefined' ? window.localStorage?.getItem(cooldownKey) : null;
        const last = lastRaw ? Number(lastRaw) : 0;
        if (Number.isFinite(last) && last > 0) {
          const oneHour = 60 * 60 * 1000;
          if (Date.now() - last < oneHour) {
            return;
          }
        }
      } catch {
        // ignore localStorage failures
      }

      try {
        if (typeof window !== 'undefined') {
          window.localStorage?.setItem(cooldownKey, String(Date.now()));
        }
      } catch {
        // ignore
      }

      const contactStore = useContactStore.getState();
      const existing =
        contactStore.getContactByInboxId(identity.inboxId) ??
        contactStore.getContactByAddress(identity.address);

      const storage = await getStorage();
      await syncSelfFarcasterProfile({
        identity,
        apiKey,
        existingContact: existing,
        putIdentity: (next) => storage.putIdentity(next),
        setIdentity: (next) => useAuthStore.getState().setIdentity(next),
        upsertContactProfile: (input) => contactStore.upsertContactProfile(input),
      });
    };

    void run();
  }, [identity]);

  // Global message listener - handles ALL incoming XMTP messages
  // Intentionally register once; store/state is accessed via getState() where needed.
  useEffect(() => {
    const shouldRefreshContact = (contact: Contact): boolean => {
      const now = Date.now();
      const lastSynced = contact.lastSyncedAt ?? 0;
      const refreshIntervalMs = 30 * 60 * 1000; // 30 minutes
      if (!contact.preferredName || !contact.preferredAvatar) {
        return true;
      }
      return now - lastSynced > refreshIntervalMs;
    };

    const enrichContactProfile = async (contact: Contact) => {
      try {
        if (!shouldRefreshContact(contact)) return;
        const xmtp = getXmtpClient();
        const profile = await xmtp.fetchInboxProfile(contact.inboxId);
        await useContactStore.getState().upsertContactProfile({
          inboxId: profile.inboxId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          primaryAddress: profile.primaryAddress,
          addresses: profile.addresses,
          identities: profile.identities,
          source: 'inbox',
          metadata: { ...contact, lastSyncedAt: Date.now() },
        });
      } catch (error) {
        console.warn('[Layout] Failed to enrich contact profile:', error);
      }
    };

    const handleIncomingMessage = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        conversationId: string;
        message: XmtpMessage;
        isHistory?: boolean;
      }>;
      const { conversationId, message, isHistory } = customEvent.detail;

      console.log('[Layout] Global message listener: received message', {
        conversationId,
        messageId: message.id,
        senderInboxId: message.senderAddress,
      });

      try {
        const senderInboxId = message.senderAddress;
        const storage = await getStorage();
        if (await storage.isConversationDeleted(conversationId)) {
          console.info('[Layout] Skipping message for deleted conversation:', conversationId);
          return;
        }
        const normalizedSender = senderInboxId?.toLowerCase?.();
        if (normalizedSender && (await storage.isPeerDeleted(normalizedSender))) {
          console.info('[Layout] Skipping message for peer marked as deleted:', normalizedSender);
          return;
        }
        const contactStore = useContactStore.getState();
        const xmtp = getXmtpClient();
        const existingContact =
          contactStore.getContactByInboxId(senderInboxId) ?? contactStore.getContactByAddress(senderInboxId);

        // Drop messages from blocked senders to avoid recreating DMs on refresh
        if (existingContact?.isBlocked) {
          console.info('[Layout] Dropping message from blocked inbox:', senderInboxId);
          return;
        }

        // Check if this message is a profile message (cv:profile: prefix)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messageContent = typeof message.content === 'string' ? message.content : (message as any).encodedContent?.content;
        const isProfileMessage = typeof messageContent === 'string' && messageContent.startsWith('cv:profile:');

        let profileFromMessage: { displayName?: string; avatarUrl?: string } | undefined;
        if (isProfileMessage) {
          try {
            const json = messageContent.slice('cv:profile:'.length);
            const profileData = JSON.parse(json) as { displayName?: string; avatarUrl?: string; type?: string; v?: number };
            if (profileData.type === 'profile') {
              profileFromMessage = {
                displayName: profileData.displayName,
                avatarUrl: profileData.avatarUrl,
              };
              console.log('[Layout] ✅ Extracted profile from incoming message', {
                senderInboxId,
                hasDisplayName: !!profileFromMessage.displayName,
                hasAvatar: !!profileFromMessage.avatarUrl,
              });
            }
          } catch (e) {
            console.warn('[Layout] Failed to parse profile message:', e);
          }
        }

        // Avoid hammering utils/preferences for every message: refresh at most every 5 minutes per contact
        const nowTs = Date.now();
        const lastSync = existingContact?.lastSyncedAt ?? 0;
        let profile = undefined as Awaited<ReturnType<typeof xmtp.fetchInboxProfile>> | undefined;
        if (!existingContact || nowTs - lastSync > 5 * 60 * 1000) {
          profile = await xmtp.fetchInboxProfile(senderInboxId);
        }

        // If we got profile from the message, use it (it's more recent than fetchInboxProfile)
        if (profileFromMessage && profile) {
          profile = {
            ...profile,
            displayName: profileFromMessage.displayName ?? profile.displayName,
            avatarUrl: profileFromMessage.avatarUrl ?? profile.avatarUrl,
          };
        } else if (profileFromMessage && !profile) {
          // If we have profile from message but no profile from fetch, create a minimal one
          profile = {
            inboxId: senderInboxId,
            displayName: profileFromMessage.displayName,
            avatarUrl: profileFromMessage.avatarUrl,
            primaryAddress: undefined,
            addresses: [],
            identities: [],
          };
        }

        let contact = existingContact;
        // Only automatically add to contacts if they have a display name set
        if (profile && profile.displayName) {
          contact = await contactStore.upsertContactProfile({
            inboxId: senderInboxId,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            primaryAddress: profile.primaryAddress,
            addresses: profile.addresses,
            identities: profile.identities,
            source: 'inbox',
          });
        }

        if (contact?.isBlocked) {
          console.info('[Layout] Dropping message after contact refresh because contact is blocked:', senderInboxId);
          return;
        }

        // Enrich with ENS (and Farcaster if available) asynchronously
        if (contact) {
          void enrichContactProfile(contact);
        }

        const resolvedDisplayName =
          contact?.preferredName ??
          contact?.name ??
          profile?.displayName ??
          senderInboxId ??
          'Unknown Sender';
        const resolvedAvatar = contact?.preferredAvatar ?? contact?.avatar ?? profile?.avatarUrl;

        let conversation = useConversationStore.getState().conversations.find((c) => c.id === conversationId);
        const preservedReadState = getResyncReadStateFor(conversationId);

        const peerKeyBase = contact?.inboxId || senderInboxId;

        if (!conversation) {
          console.log('[Layout] Creating new conversation for:', conversationId);

          const peerId = peerKeyBase ?? senderInboxId ?? 'unknown-peer';
          // Avoid creating a self-DM conversation
          const myInbox = getXmtpClient().getInboxId()?.toLowerCase();
          if (peerId && myInbox && peerId.toLowerCase() === myInbox) {
            console.log('[Layout] Skipping creation of self-DM conversation');
            return;
          }
          const newConversation: Conversation = {
            id: conversationId,
            peerId,
            createdAt: Date.now(),
            lastMessageAt: message.sentAt || Date.now(),
            lastMessagePreview: '',
            unreadCount: 0,
            pinned: false,
            archived: false,
            displayName: resolvedDisplayName,
            displayAvatar: resolvedAvatar,
            lastMessageId: message.id,
            lastMessageSender: message.senderAddress,
            lastReadAt: preservedReadState?.lastReadAt ?? 0,
            lastReadMessageId: preservedReadState?.lastReadMessageId ?? undefined,
          };

          addConversation(newConversation);
          await storage.putConversation(newConversation);

          console.log('[Layout] ✅ New conversation created:', newConversation);

          conversation = newConversation;
          // Deduplicate: remove any other DM with same peer id
          try {
            const store = useConversationStore.getState();
            const peerKey = (peerKeyBase ?? peerId)?.toLowerCase?.();
            if (peerKey) {
              const dupes = store.conversations.filter(
                (c) => !c.isGroup && c.id !== newConversation.id && c.peerId.toLowerCase() === peerKey
              );
              for (const d of dupes) {
                store.removeConversation(d.id);
                try {
                  await storage.deleteConversation(d.id);
                } catch (e) {
                  /* ignore */
                }
              }
            }
          } catch (e) { /* ignore */ }
        } else {
          // Update display fields using the PEER's profile, not the sender of this message.
          const contactStoreNow = useContactStore.getState();
          const peerKey = conversation.peerId?.toLowerCase?.();
          const peerContact = peerKey
            ? contactStoreNow.getContactByInboxId(peerKey) ?? contactStoreNow.getContactByAddress(peerKey)
            : undefined;

          const updates: Partial<Conversation> = {};

          // Only use peer contact's display name, never the sender's
          const displayName = peerContact?.preferredName ?? peerContact?.name;
          if (displayName && conversation.displayName !== displayName) {
            updates.displayName = displayName;
          }

          // Only use peer contact's avatar, never the sender's
          const avatar = peerContact?.preferredAvatar ?? peerContact?.avatar;
          if (avatar && conversation.displayAvatar !== avatar) {
            updates.displayAvatar = avatar;
          }

          // If peer contact doesn't exist, fetch peer's profile from XMTP (not sender's)
          if (!peerContact && peerKey && (!displayName || !avatar)) {
            try {
              const peerProfile = await xmtp.fetchInboxProfile(peerKey);
              if (peerProfile.displayName && !displayName && conversation.displayName !== peerProfile.displayName) {
                updates.displayName = peerProfile.displayName;
              }
              if (peerProfile.avatarUrl && !avatar && conversation.displayAvatar !== peerProfile.avatarUrl) {
                updates.displayAvatar = peerProfile.avatarUrl;
              }
            } catch (e) {
              // Non-fatal - will use fallback formatIdentifier in ConversationView
              console.warn('[Layout] Failed to fetch peer profile for conversation:', e);
            }
          }

          if (Object.keys(updates).length > 0) {
            updateConversation(conversation.id, updates);
            await storage.putConversation({ ...conversation, ...updates });
            conversation = { ...conversation, ...updates } as Conversation;
          }
          if (preservedReadState) {
            const readUpdates: Partial<Conversation> = {};
            if (
              preservedReadState.lastReadAt !== undefined &&
              (conversation.lastReadAt ?? 0) < preservedReadState.lastReadAt
            ) {
              readUpdates.lastReadAt = preservedReadState.lastReadAt;
            }
            if (
              preservedReadState.lastReadMessageId !== undefined &&
              conversation.lastReadMessageId !== preservedReadState.lastReadMessageId
            ) {
              readUpdates.lastReadMessageId = preservedReadState.lastReadMessageId ?? undefined;
            }
            if (Object.keys(readUpdates).length > 0) {
              updateConversation(conversation.id, readUpdates);
              await storage.putConversation({ ...conversation, ...readUpdates });
              conversation = { ...conversation, ...readUpdates } as Conversation;
            }
          }
          // Deduplicate against existing by peer id also when conversation already existed
          try {
            const store = useConversationStore.getState();
            const peerKey = (peerKeyBase ?? conversation!.peerId)?.toLowerCase?.();
            if (peerKey) {
              const dupes = store.conversations.filter(
                (c) => !c.isGroup && c.id !== conversation!.id && c.peerId.toLowerCase() === peerKey
              );
              for (const d of dupes) {
                store.removeConversation(d.id);
                try {
                  await storage.deleteConversation(d.id);
                } catch (e) {
                  /* ignore */
                }
              }
            }
          } catch (e) { /* ignore */ }
        }

        // Ensure our profile (displayName/avatar) is sent to this conversation
        // This checks message history and sends missing profile data
        // Do this for both new and existing conversations
        if (conversation && !conversation.isGroup) {
          try {
            const xmtp = getXmtpClient();
            await xmtp.ensureProfileSent(conversationId);
          } catch (profileError) {
            console.warn('[Layout] Failed to ensure profile sent (non-fatal):', profileError);
          }
        }

        // Skip storing profile messages as regular messages (they're metadata, not chat content)
        if (!isProfileMessage) {
          console.log('[Layout] Processing message with receiveMessage()');
          await receiveMessage(conversationId, message, { isHistory: Boolean(isHistory) });
        } else {
          console.log('[Layout] Skipping storage of profile message (metadata only)');
        }

        console.log('[Layout] ✅ Message processed successfully');
      } catch (error) {
        console.error('[Layout] Failed to handle incoming message:', error);
      }
    };

    console.log('[Layout] 🎧 Global message listener registered');
    window.addEventListener('xmtp:message', handleIncomingMessage);
    // Also handle system messages (e.g., membership changes)
    const handleSystemMessage = async (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId: string;
        system: { id: string; senderInboxId?: string; body: string; sentAt?: number };
      }>;
      const { conversationId, system } = custom.detail;
      try {
        const storage = await getStorage();
        const msg = {
          id: system.id,
          conversationId,
          sender: system.senderInboxId || 'system',
          sentAt: system.sentAt || Date.now(),
          receivedAt: Date.now(),
          type: 'system' as const,
          body: system.body,
          status: 'delivered' as const,
          reactions: [],
        };
        useMessageStore.getState().addMessage(conversationId, msg);
        await storage.putMessage(msg);
        useConversationStore.getState().updateConversation(conversationId, {
          lastMessageAt: msg.sentAt,
          lastMessagePreview: msg.body.substring(0, 100),
        });
      } catch (err) {
        console.warn('[Layout] Failed to handle system message', err);
      }
    };
    window.addEventListener('xmtp:system', handleSystemMessage);

    // Handle inbound reactions and aggregate onto the target message
    const handleReaction = async (event: Event) => {
      try {
        const custom = event as CustomEvent<{
          conversationId: string;
          referenceMessageId: string;
          emoji: string;
          action: string;
          senderInboxId?: string;
        }>;
        const empty = {
          conversationId: '',
          referenceMessageId: '',
          emoji: '',
          action: '',
          senderInboxId: '' as string | undefined,
        };
        const { conversationId, referenceMessageId, emoji, action, senderInboxId } = custom.detail || empty;
        if (!conversationId || !referenceMessageId || !emoji) return;

        const state = useMessageStore.getState();
        const msgs = state.messagesByConversation[conversationId] || [];
        const target = msgs.find((m) => m.id === referenceMessageId);
        if (!target) return;
        const mineInbox = getXmtpClient().getInboxId()?.toLowerCase();
        const sender = (senderInboxId || '').toLowerCase();
        const current = target.reactions || [];
        if ((action || 'added').toLowerCase() === 'removed') {
          const filtered = current.filter((r) => !(r.emoji === emoji && r.sender?.toLowerCase?.() === sender));
          state.updateMessage(referenceMessageId, { reactions: filtered });
          try {
            const storage = await getStorage();
            await storage.updateMessageReactions(referenceMessageId, filtered);
          } catch {
            // ignore persist failure
          }
        } else {
          // add, but enforce single instance per emoji per sender
          const filtered = current.filter((r) => !(r.emoji === emoji && r.sender?.toLowerCase?.() === sender));
          filtered.push({ emoji, sender: senderInboxId || mineInbox || 'peer', timestamp: Date.now() });
          state.updateMessage(referenceMessageId, { reactions: filtered });
          try {
            const storage = await getStorage();
            await storage.updateMessageReactions(referenceMessageId, filtered);
          } catch {
            // ignore persist failure
          }
        }
      } catch (err) {
        console.warn('[Layout] Failed to handle reaction', err);
      }
    };
    window.addEventListener('xmtp:reaction', handleReaction);

    // Handle group metadata updates (name/image/description and membership changes)
    const handleGroupUpdated = async (event: Event) => {
      try {
        const custom = event as CustomEvent<{ conversationId: string; content: unknown }>;
        const { conversationId, content } = custom.detail || {};
        if (!conversationId) return;

        // Attempt lightweight local patch for metadata fields first
        const any = (content as Record<string, unknown>) || {};
        const changes = (any['metadataFieldChanges'] as Array<{ fieldName: string; newValue?: string }> | undefined) || [];
        const added = (any['addedInboxes'] as Array<{ inboxId: string }> | undefined) || [];
        const removed = (any['removedInboxes'] as Array<{ inboxId: string }> | undefined) || [];

        const storage = await getStorage();
        const existing = await storage.getConversation(conversationId);
        const updates: Partial<Conversation> = {};
        for (const c of changes) {
          const field = (c.fieldName || '').toString();
          const val = (c.newValue ?? '').toString().trim();
          if (field === 'group_name') updates.groupName = val || undefined;
          else if (field === 'group_image_url_square') updates.groupImage = val || undefined;
          else if (field === 'description') updates.groupDescription = val || undefined;
        }
        if (Object.keys(updates).length && existing) {
          await storage.putConversation({ ...existing, ...updates });
          useConversationStore.getState().updateConversation(conversationId, updates);
        }

        // If membership changed or no metadata changes detected, refresh authoritative details
        const membershipChanged = added.length > 0 || removed.length > 0;
        if (membershipChanged || (!changes || changes.length === 0)) {
          try {
            const xmtp = getXmtpClient();
            const details = await xmtp.fetchGroupDetails(conversationId);
            if (details) {
              // Map GroupDetails -> Partial<Conversation> (mirror with safe field updates)
              const memberIdentifiers = details.members.map((m) => (m.address ? m.address : m.inboxId));
              const uniqueMembers = Array.from(new Set(memberIdentifiers.filter(Boolean)));
              const memberInboxes = details.members.map((m) => m.inboxId).filter(Boolean);
              const adminInboxes = Array.from(new Set(details.adminInboxes));
              const superAdminInboxes = Array.from(new Set(details.superAdminInboxes));
              const groupMembers = details.members.map((m) => ({
                inboxId: m.inboxId,
                address: m.address,
                permissionLevel: m.permissionLevel,
                isAdmin: m.isAdmin,
                isSuperAdmin: m.isSuperAdmin,
              }));
              const merged: Partial<Conversation> = {
                members: uniqueMembers,
                memberInboxes,
                adminInboxes,
                superAdminInboxes,
                groupMembers,
              };
              const name = details.name?.trim();
              if (name) merged.groupName = name;
              const img = details.imageUrl?.trim();
              if (img) merged.groupImage = img;
              const desc = details.description?.trim();
              if (desc) merged.groupDescription = desc;
              if (details.permissions) {
                merged.groupPermissions = {
                  policyType: details.permissions.policyType,
                  policySet: { ...details.permissions.policySet },
                };
              }
              const current = existing || (await storage.getConversation(conversationId));
              if (current) {
                await storage.putConversation({ ...current, ...merged });
              }
              useConversationStore.getState().updateConversation(conversationId, merged);
            }
          } catch (err) {
            console.warn('[Layout] Failed to refresh group details after update', err);
          }
        }
      } catch (err) {
        console.warn('[Layout] Failed to handle xmtp:group-updated event', err);
      }
    };
    window.addEventListener('xmtp:group-updated', handleGroupUpdated);

    // Handle read receipts for status updates (no bubbles)
    const handleReadReceipt = async (event: Event) => {
      const custom = event as CustomEvent<{ conversationId: string; senderInboxId?: string; sentAt?: number }>;
      const { conversationId, sentAt } = custom.detail;
      try {
        const myInbox = getXmtpClient().getInboxId()?.toLowerCase();
        const myAddr = getXmtpClient().getAddress()?.toLowerCase();
        const state = useMessageStore.getState();
        const msgs = state.messagesByConversation[conversationId] || [];
        for (const m of msgs) {
          const senderLower = m.sender?.toLowerCase?.();
          if (senderLower && (senderLower === myInbox || senderLower === myAddr)) {
            if (!sentAt || m.sentAt <= sentAt) {
              state.updateMessage(m.id, { status: 'delivered' });
              try {
                const storage = await getStorage();
                await storage.updateMessageStatus(m.id, 'delivered');
              } catch (e) {
                // ignore storage failure
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Layout] Failed to handle read receipt', err);
      }
    };
    window.addEventListener('xmtp:read-receipt', handleReadReceipt);

    return () => {
      console.log('[Layout] 🔇 Global message listener unregistered');
      window.removeEventListener('xmtp:message', handleIncomingMessage);
      window.removeEventListener('xmtp:system', handleSystemMessage);
      window.removeEventListener('xmtp:read-receipt', handleReadReceipt);
      window.removeEventListener('xmtp:reaction', handleReaction);
      window.removeEventListener('xmtp:group-updated', handleGroupUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proactively enrich all loaded contacts from XMTP (no ENS/Farcaster),
  // but only after XMTP is connected to avoid Utils network calls during connect.
  const connectionStatus = useXmtpStore((s) => s.connectionStatus);
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const run = async () => {
      // 1) Flush any pending profile save queued while disconnected
      try {
        const me = useAuthStore.getState().identity;
        const inboxKey = (me?.inboxId || me?.address || '').toLowerCase();
        if (inboxKey && typeof window !== 'undefined') {
          const pendingKey = `pending-profile-save:${inboxKey}`;
          const raw = window.localStorage.getItem(pendingKey);
          if (raw) {
            try {
              const payload = JSON.parse(raw) as { displayName?: string; avatarUrl?: string };
              const xmtp = getXmtpClient();
              await xmtp.saveProfile(payload.displayName, payload.avatarUrl);
              window.localStorage.removeItem(pendingKey);
              try { window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Profile published to XMTP' })); } catch (e) {
                // ignore
              }
              console.log('[Layout] ✅ Flushed pending profile save to XMTP');
            } catch (e) {
              console.warn('[Layout] Failed to flush pending profile save:', e);
            }
          }
        }
      } catch (e) {
        console.warn('[Layout] Pending profile flush skipped:', e);
      }

      // 2) Proactively enrich contacts from XMTP
      try {
        const state = useContactStore.getState();
        for (const c of state.contacts) {
          const now = Date.now();
          const last = c.lastSyncedAt ?? 0;
          if (!c.preferredName || !c.preferredAvatar || now - last > 30 * 60 * 1000) {
            try {
              const xmtp = getXmtpClient();
              const profile = await xmtp.fetchInboxProfile(c.inboxId);
              await state.upsertContactProfile({
                inboxId: profile.inboxId,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                primaryAddress: profile.primaryAddress,
                addresses: profile.addresses,
                identities: profile.identities,
                source: 'inbox',
                metadata: { ...c, lastSyncedAt: Date.now() },
              });
            } catch {
              // non-fatal
            }
          }
        }
      } catch {
        // ignore
      }
    };
    run();
  }, [connectionStatus]);

  return (
    <div className="flex h-full flex-col text-primary-50">
      <OperationProgressBar />
      {/* Sync progress bar */}
      <SyncProgressBar />
      <ToastContainer />

      {/* Header */}
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-3 py-2 flex items-center justify-between gap-2 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-3">
          <InboxSwitcher />
          <h1 className="hidden text-lg font-bold text-primary-50 sm:block">Converge</h1>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-end mr-2">
            <span className="text-[10px] text-primary-400">
              Last checked: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never'}
            </span>
            <button
              onClick={handleCheckInbox}
              disabled={isChecking}
              className="text-[10px] text-primary-300 hover:text-primary-100 underline disabled:opacity-50"
            >
              {isChecking ? 'Checking...' : 'Check now'}
            </button>
          </div>
          <Link
            to="/search"
            className="p-2 text-primary-200 hover:text-white border border-primary-800/60 hover:border-primary-700 rounded-lg transition-colors bg-primary-900/40 hover:bg-primary-800/60"
            title="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-primary-950/20">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="sticky bottom-0 bg-primary-950/80 border-t border-primary-800/60 px-4 py-3 backdrop-blur-md shadow-inner" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <div className="flex justify-around max-w-lg mx-auto">
          <Link
            to="/contacts"
            aria-label="Contacts"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${location.pathname === '/contacts'
              ? 'text-accent-300 bg-primary-900/70 shadow-lg'
              : 'text-primary-300 hover:text-primary-100'
              }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" role="img" aria-hidden="true">
              <title>Contacts</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.75 9a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4.5 19.5a8.999 8.999 0 1115 0" />
            </svg>
            <span className="text-xs mt-1">Contacts</span>
          </Link>

          <Link
            to="/"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${location.pathname === '/'
              ? 'text-accent-300 bg-primary-900/70 shadow-lg'
              : 'text-primary-300 hover:text-primary-100'
              }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-xs mt-1">Chats</span>
          </Link>

          <Link
            to="/settings"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${location.pathname === '/settings'
              ? 'text-accent-300 bg-primary-900/70 shadow-lg'
              : 'text-primary-300 hover:text-primary-100'
              }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1">Settings</span>
          </Link>

          <DebugLogPanel />
        </div>
      </nav>
      {showPersonalizationReminder && identity && shouldShowPersonalizationNag && (
        <PersonalizationReminderModal
          missingDisplayName={missingDisplayName}
          missingAvatar={missingAvatar}
          onRemindLater={handleRemindLater}
          onDismissForever={handleDismissForever}
        />
      )}
    </div>
  );
}
