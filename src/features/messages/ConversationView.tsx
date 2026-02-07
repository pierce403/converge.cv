import { useEffect, useRef, useMemo, useState, Fragment, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMessageStore, useAuthStore, useContactStore, useFarcasterStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { useMessages } from './useMessages';
import { ContactCardModal } from '@/components/ContactCardModal';
import { getContactInfo } from '@/lib/default-contacts';
import { sanitizeImageSrc } from '@/lib/utils/image';
import { AddContactButton } from '@/features/contacts/AddContactButton';
import { getXmtpClient } from '@/lib/xmtp';
import { GroupInviteModal } from '@/features/conversations/GroupInviteModal';
import type { Message } from '@/types';
import type { Contact as ContactType } from '@/lib/stores/contact-store';
import { Menu, Transition, Portal } from '@headlessui/react';
import { evaluateContactAgainstFilters } from '@/lib/farcaster/filters';
import type { MentionCandidate } from '@/lib/utils/mentions';

const formatIdentifier = (value: string) => {
  if (!value) {
    return '';
  }
  if (value.startsWith('0x') && value.length > 10) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
  if (value.length > 18) {
    return `${value.slice(0, 10)}...${value.slice(-4)}`;
  }
  return value;
};

export function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const isPrependingRef = useRef(false);
  const initialLoadRef = useRef(false);
  const [contactForModal, setContactForModal] = useState<ContactType | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInviteModalOpen, setInviteModalOpen] = useState(false);
  const lastScrollTopRef = useRef<number>(0);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  const {
    conversations,
    hideConversation,
    deleteGroup,
    toggleMute,
    markAsRead,
    setActiveConversation,
  } = useConversations();
  const conversationId = id ?? '';
  const messages = useMessageStore(
    (state) => state.messagesByConversation[conversationId] ?? [],
  );
  const isConversationLoading = useMessageStore(
    (state) => state.loadingConversations[conversationId] ?? false,
  );
  const hasLoadedConversation = useMessageStore(
    (state) => state.loadedConversations[conversationId] ?? false,
  );
  const { sendMessage, sendAttachment, loadMessages, loadOlderMessages, sendReadReceiptFor } = useMessages();
  const { identity } = useAuthStore(); // Get current user identity
  const contacts = useContactStore((state) => state.contacts);
  const isContact = useContactStore((state) => state.isContact);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const farcasterFilters = useFarcasterStore((state) => state.filters);

  const contactsByInboxId = useMemo(() => {
    const map = new Map<string, ContactType>();
    contacts.forEach((contact) => {
      map.set(contact.inboxId.toLowerCase(), contact);
    });
    return map;
  }, [contacts]);

  const contactsByAddress = useMemo(() => {
    const map = new Map<string, ContactType>();
    contacts.forEach((contact) => {
      if (contact.primaryAddress) {
        map.set(contact.primaryAddress.toLowerCase(), contact);
      }
      contact.addresses?.forEach((address) => {
        map.set(address.toLowerCase(), contact);
      });
    });
    return map;
  }, [contacts]);

  const conversation = conversations.find((c) => c.id === id);

  const composerRef = useRef<HTMLDivElement>(null);
  const lastMarkedRef = useRef<number>(0);

  const isCurrentUserAdmin = useMemo(() => {
    if (!conversation?.isGroup || !identity?.address || !conversation.admins) {
      return false;
    }
    return conversation.admins.includes(identity.address);
  }, [conversation, identity]);

  const isGroupMember = useMemo(() => {
    if (!conversation?.isGroup) {
      return true;
    }
    const myInbox = identity?.inboxId?.toLowerCase();
    const myAddress = identity?.address?.toLowerCase();
    const inboxSet = new Set<string>();
    conversation.memberInboxes?.forEach((memberInbox) => {
      if (memberInbox) {
        inboxSet.add(memberInbox.toLowerCase());
      }
    });
    conversation.groupMembers?.forEach((member) => {
      if (member.inboxId) {
        inboxSet.add(member.inboxId.toLowerCase());
      }
    });
    if (inboxSet.size > 0 && myInbox) {
      return inboxSet.has(myInbox);
    }

    if (!myInbox && inboxSet.size > 0) {
      // No inbox information available, but group lists members
      return false;
    }

    if (!myInbox && !myAddress) {
      return true;
    }

    const addressSet = new Set<string>();
    conversation.members?.forEach((member) => {
      if (member) {
        addressSet.add(member.trim().toLowerCase());
      }
    });
    if (conversation.groupMembers) {
      conversation.groupMembers.forEach((member) => {
        if (member.address) {
          addressSet.add(member.address.trim().toLowerCase());
        }
      });
    }
    if (addressSet.size === 0) {
      return true;
    }
    if (myAddress && addressSet.has(myAddress)) {
      return true;
    }
    return myInbox ? inboxSet.has(myInbox) : false;
  }, [conversation, identity?.inboxId, identity?.address]);

  const showInitialLoading = isConversationLoading && !isRefreshing && !hasLoadedConversation;

  useEffect(() => {
    if (id) {
      initialLoadRef.current = false;
      setHasMoreMessages(true);
      loadMessages(id).then((result) => {
        setHasMoreMessages(result.hasMore);
      });
    }
  }, [id, loadMessages]);

  // Pull-to-refresh: detect scroll to top and sync messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !id) return;

    let touchStartY = 0;
    let isPulling = false;
    let refreshTimeout: number | null = null;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const isAtTop = scrollTop <= 5; // Small threshold for touch devices
      lastScrollTopRef.current = scrollTop;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isAtBottomRef.current = distanceFromBottom < 80;

      // If already at top and user tries to scroll further (scrollTop stays at 0)
      // This happens when browser tries to scroll but we're already at top
      if (isAtTop && !isRefreshing && !isConversationLoading && !isPulling) {
        // Debounce to avoid multiple triggers
        if (refreshTimeout) {
          window.clearTimeout(refreshTimeout);
        }
        refreshTimeout = window.setTimeout(() => {
          if (container.scrollTop <= 5 && !isRefreshing && !isConversationLoading) {
            if (hasMoreMessages && !isLoadingOlder) {
              isPulling = true;
              setIsLoadingOlder(true);
              const prevHeight = container.scrollHeight;
              const prevTop = container.scrollTop;
              isPrependingRef.current = true;
              loadOlderMessages(id)
                .then((result) => {
                  setHasMoreMessages(result.hasMore);
                  requestAnimationFrame(() => {
                    const nextHeight = container.scrollHeight;
                    container.scrollTop = nextHeight - prevHeight + prevTop;
                    isPrependingRef.current = false;
                  });
                })
                .finally(() => {
                  setIsLoadingOlder(false);
                  isPulling = false;
                });
            } else if (!isRefreshing) {
              isPulling = true;
              setIsRefreshing(true);
              loadMessages(id, true)
                .then((result) => {
                  setHasMoreMessages(result.hasMore);
                })
                .finally(() => {
                  setIsRefreshing(false);
                  isPulling = false;
                });
            }
          }
        }, 100);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      const scrollTop = container.scrollTop;
      const isAtTop = scrollTop <= 5;
      const pullDistance = touchY - touchStartY;
      const isPullingDown = pullDistance > 30 && isAtTop; // Require 30px pull

      // If pulling down at top, load older messages (or refresh when at the beginning)
      if (isPullingDown && !isRefreshing && !isConversationLoading && !isPulling) {
        isPulling = true;
        if (hasMoreMessages && !isLoadingOlder) {
          setIsLoadingOlder(true);
          const prevHeight = container.scrollHeight;
          const prevTop = container.scrollTop;
          isPrependingRef.current = true;
          loadOlderMessages(id)
            .then((result) => {
              setHasMoreMessages(result.hasMore);
              requestAnimationFrame(() => {
                const nextHeight = container.scrollHeight;
                container.scrollTop = nextHeight - prevHeight + prevTop;
                isPrependingRef.current = false;
              });
            })
            .finally(() => {
              setIsLoadingOlder(false);
              isPulling = false;
            });
        } else {
          setIsRefreshing(true);
          loadMessages(id, true)
            .then((result) => {
              setHasMoreMessages(result.hasMore);
            })
            .finally(() => {
              setIsRefreshing(false);
              isPulling = false;
            });
        }
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
    };
  }, [
    id,
    loadMessages,
    loadOlderMessages,
    isRefreshing,
    isConversationLoading,
    hasMoreMessages,
    isLoadingOlder,
  ]);



  useEffect(() => {
    setContactForModal(null);
  }, [id]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!id) return;
    setActiveConversation(id);
    return () => {
      setActiveConversation(null);
    };
  }, [id, setActiveConversation]);

  useEffect(() => {
    if (!conversation?.isGroup) {
      return;
    }

    const memberSet = new Set<string>();
    conversation.groupMembers?.forEach((member) => {
      if (member.inboxId) {
        memberSet.add(member.inboxId.toLowerCase());
      }
    });
    conversation.memberInboxes?.forEach((memberInbox) => {
      if (memberInbox) {
        memberSet.add(memberInbox.toLowerCase());
      }
    });

    if (memberSet.size === 0) {
      return;
    }

    const myInboxLower = identity?.inboxId?.toLowerCase();
    let cancelled = false;

    const run = async () => {
      try {
        const xmtp = getXmtpClient();
        const contactStore = useContactStore.getState();
        for (const memberInbox of memberSet) {
          if (cancelled) {
            break;
          }
          if (!memberInbox) {
            continue;
          }
          if (myInboxLower && memberInbox === myInboxLower) {
            continue;
          }
          try {
            const existing = contactStore.getContactByInboxId(memberInbox);
            if (!existing) {
              continue;
            }

            const now = Date.now();
            const last = existing.lastSyncedAt ?? 0;
            if (existing.preferredName && existing.preferredAvatar && now - last < 30 * 60 * 1000) {
              continue;
            }

            const profile = await xmtp.fetchInboxProfile(memberInbox);
            if (cancelled) {
              return;
            }

            await contactStore.upsertContactProfile({
              inboxId: profile.inboxId ?? memberInbox,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              primaryAddress: profile.primaryAddress,
              addresses: profile.addresses,
              identities: profile.identities,
              source: 'inbox',
              metadata: { ...existing, lastSyncedAt: Date.now() },
            });
          } catch (error) {
            console.warn('[ConversationView] Failed to refresh member profile', memberInbox, error);
          }
        }
      } catch (error) {
        console.warn('[ConversationView] Failed to load group member profiles', error);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [conversation?.id, conversation?.isGroup, conversation?.groupMembers, conversation?.memberInboxes, identity?.inboxId]);

  // Note: Message handling is done globally in Layout.tsx
  // This component just displays messages from the store

  useEffect(() => {
    if (!messagesContainerRef.current) {
      return;
    }
    if (messages.length === 0) {
      return;
    }
    if (!initialLoadRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      initialLoadRef.current = true;
      return;
    }
    if (isPrependingRef.current) {
      return;
    }
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (id && messages.length > 0 && conversation && !conversation.isGroup) {
      // Compute latest incoming message timestamp; send one receipt if needed
      const myInbox = identity?.inboxId?.toLowerCase();
      const myAddr = identity?.address?.toLowerCase();
      let latestIncomingAt = 0;
      for (const m of messages) {
        const s = m.sender?.toLowerCase?.();
        const fromPeer = s && s !== myInbox && s !== myAddr;
        if (fromPeer) latestIncomingAt = Math.max(latestIncomingAt, m.sentAt || 0);
      }
      if (latestIncomingAt) {
        void sendReadReceiptFor(id, latestIncomingAt);
      }
    }
  }, [messages, id, conversation, identity?.inboxId, identity?.address, sendReadReceiptFor]);

  useEffect(() => {
    if (!id || !conversation || conversation.isGroup) {
      return;
    }
    const myInbox = identity?.inboxId?.toLowerCase();
    const myAddr = identity?.address?.toLowerCase();
    let latestIncomingAt = 0;
    let latestIncomingId: string | undefined;
    for (const message of messages) {
      const senderLower = message.sender?.toLowerCase?.();
      const fromPeer = senderLower && senderLower !== myInbox && senderLower !== myAddr;
      if (fromPeer) {
        const sentAt = message.sentAt || 0;
        if (sentAt >= latestIncomingAt) {
          latestIncomingAt = sentAt;
          latestIncomingId = message.id;
        }
      }
    }
    const conversationLastRead = conversation.lastReadAt ?? 0;
    const previousMarked = lastMarkedRef.current;
    const effectiveBaseline = Math.max(conversationLastRead, previousMarked);
    if (!latestIncomingAt) {
      if (conversation.unreadCount > 0) {
        void markAsRead(id, { lastReadAt: Date.now() });
      }
      return;
    }
    if (latestIncomingAt > effectiveBaseline || (conversation.unreadCount ?? 0) > 0) {
      lastMarkedRef.current = latestIncomingAt;
      void markAsRead(id, {
        lastReadAt: latestIncomingAt,
        lastReadMessageId: latestIncomingId,
      });
    }
  }, [
    id,
    conversation,
    conversation?.lastReadAt,
    conversation?.unreadCount,
    messages,
    identity?.inboxId,
    identity?.address,
    markAsRead,
  ]);

  const contact = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    const peerLower = conversation.peerId.toLowerCase();
    return (
      contacts.find((entry) => entry.inboxId.toLowerCase() === peerLower) ??
      contacts.find((entry) =>
        entry.addresses?.some((address) => address.toLowerCase() === peerLower)
      )
    );
  }, [conversation, contacts]);

  const defaultContactInfo = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    const lookupKey = contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId;
    return getContactInfo(lookupKey);
  }, [conversation, contact]);



  const conversationDisplayName = useMemo(() => {
    if (!conversation) {
      return '';
    }
    if (conversation.isGroup) {
      return conversation.groupName || 'Group Chat';
    }
    return conversation.displayName
      || contact?.preferredName
      || contact?.name
      || defaultContactInfo?.name
      || formatIdentifier(contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId);
  }, [conversation, contact, defaultContactInfo]);

  const conversationAvatar = useMemo(() => {
    if (!conversation) {
      return undefined;
    }
    if (conversation.isGroup) {
      return conversation.groupImage || conversation.displayAvatar;
    }
    return (
      conversation.displayAvatar ||
      contact?.preferredAvatar ||
      contact?.avatar ||
      defaultContactInfo?.avatar
    );
  }, [conversation, contact, defaultContactInfo]);

  const groupMemberProfiles = useMemo(() => {
    const map = new Map<string, { displayName?: string; avatar?: string; address?: string }>();
    if (!conversation?.isGroup) {
      return map;
    }

    conversation.groupMembers?.forEach((member) => {
      const inboxLower = member.inboxId?.toLowerCase?.();
      if (!inboxLower) {
        return;
      }
      const addressLower = member.address?.toLowerCase?.();
      const contactMatch =
        contactsByInboxId.get(inboxLower) || (addressLower ? contactsByAddress.get(addressLower) : undefined);
      const displayName =
        contactMatch?.preferredName ||
        contactMatch?.name ||
        member.displayName ||
        (addressLower ? formatIdentifier(addressLower) : formatIdentifier(inboxLower));
      const avatar = contactMatch?.preferredAvatar || contactMatch?.avatar || member.avatar;
      map.set(inboxLower, { displayName, avatar, address: addressLower });
    });

    conversation.memberInboxes?.forEach((memberInbox) => {
      const inboxLower = memberInbox?.toLowerCase?.();
      if (!inboxLower || map.has(inboxLower)) {
        return;
      }
      const contactMatch = contactsByInboxId.get(inboxLower);
      const addressLower = contactMatch?.primaryAddress?.toLowerCase();
      const displayName =
        contactMatch?.preferredName ||
        contactMatch?.name ||
        (addressLower ? formatIdentifier(addressLower) : formatIdentifier(inboxLower));
      const avatar = contactMatch?.preferredAvatar || contactMatch?.avatar;
      map.set(inboxLower, { displayName, avatar, address: addressLower });
    });

    return map;
  }, [conversation, contactsByInboxId, contactsByAddress]);

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!conversation?.isGroup) {
      return [];
    }

    const results: MentionCandidate[] = [];
    const seen = new Set<string>();
    const myInboxLower = identity?.inboxId?.toLowerCase();
    const myAddressLower = identity?.address?.toLowerCase();

    const addCandidate = (candidate: MentionCandidate) => {
      const key = (candidate.inboxId || candidate.address || candidate.id || candidate.display).toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }
      if (myInboxLower && candidate.inboxId?.toLowerCase() === myInboxLower) {
        return;
      }
      if (myAddressLower && candidate.address?.toLowerCase() === myAddressLower) {
        return;
      }
      seen.add(key);
      results.push(candidate);
    };

    const buildCandidate = (inboxId?: string, address?: string, displayName?: string, avatar?: string) => {
      const inboxLower = inboxId?.toLowerCase();
      const addressLower = address?.toLowerCase();
      const contact =
        (inboxLower ? contactsByInboxId.get(inboxLower) : undefined) ||
        (addressLower ? contactsByAddress.get(addressLower) : undefined);
      const preferredName = contact?.preferredName || contact?.name || displayName;
      const fallback = address || contact?.primaryAddress || inboxId;
      const display = preferredName || fallback || inboxId || address || 'Unknown';
      const secondary = preferredName ? (fallback || inboxId) : undefined;
      addCandidate({
        id: inboxLower || addressLower || display,
        display,
        secondary: secondary && secondary !== display ? secondary : undefined,
        avatarUrl: contact?.preferredAvatar || contact?.avatar || avatar,
        inboxId,
        address,
      });
    };

    conversation.groupMembers?.forEach((member) => {
      buildCandidate(member.inboxId, member.address, member.displayName, member.avatar);
    });

    conversation.memberInboxes?.forEach((memberInbox) => {
      if (!memberInbox) return;
      if (conversation.groupMembers?.some((member) => member.inboxId?.toLowerCase() === memberInbox.toLowerCase())) {
        return;
      }
      buildCandidate(memberInbox);
    });

    if ((!conversation.groupMembers || conversation.groupMembers.length === 0) && conversation.members) {
      conversation.members.forEach((memberAddress) => {
        if (!memberAddress) return;
        buildCandidate(undefined, memberAddress);
      });
    }

    results.sort((a, b) => a.display.localeCompare(b.display));
    return results;
  }, [
    conversation?.isGroup,
    conversation?.groupMembers,
    conversation?.memberInboxes,
    conversation?.members,
    contactsByInboxId,
    contactsByAddress,
    identity?.inboxId,
    identity?.address,
  ]);

  const inboxIdForActions = contact?.inboxId ?? conversation?.peerId ?? '';
  const conversationContact = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    if (contact) {
      return contact;
    }
    if (!inboxIdForActions) {
      return undefined;
    }
    const normalizedInbox = inboxIdForActions.toLowerCase();
    const fallbackAddress = defaultContactInfo?.address?.toLowerCase();
    const fallbackName =
      conversationDisplayName ||
      defaultContactInfo?.name ||
      formatIdentifier(normalizedInbox);
    return {
      inboxId: normalizedInbox,
      name: fallbackName,
      avatar: defaultContactInfo?.avatar,
      preferredAvatar: defaultContactInfo?.avatar,
      preferredName: defaultContactInfo?.name,
      createdAt: Date.now(),
      primaryAddress: fallbackAddress,
      addresses: fallbackAddress ? [fallbackAddress] : [],
      identities: fallbackAddress
        ? [
          {
            identifier: fallbackAddress,
            kind: 'Ethereum',
            isPrimary: true,
          },
        ]
        : [],
      isInboxOnly: true,
      source: 'inbox',
    } as ContactType;
  }, [conversation, conversationDisplayName, contact, inboxIdForActions, defaultContactInfo]);

  const resolveContactForSender = useCallback((senderLower: string | undefined): ContactType | null => {
    if (!senderLower) {
      return null;
    }
    const existingByInbox = contactsByInboxId.get(senderLower);
    if (existingByInbox) {
      return existingByInbox;
    }
    const existingByAddress = contactsByAddress.get(senderLower);
    if (existingByAddress) {
      return existingByAddress;
    }
    const profile = groupMemberProfiles.get(senderLower);
    const addressLower = profile?.address?.toLowerCase();
    const displayName = profile?.displayName || formatIdentifier(addressLower ?? senderLower);
    const avatar = profile?.avatar;
    return {
      inboxId: senderLower,
      name: displayName,
      avatar,
      preferredAvatar: avatar,
      preferredName: profile?.displayName,
      createdAt: Date.now(),
      primaryAddress: addressLower,
      addresses: addressLower ? [addressLower] : [],
      identities: addressLower
        ? [
          {
            identifier: addressLower,
            kind: 'Ethereum',
            isPrimary: true,
          },
        ]
        : [],
      isInboxOnly: true,
      source: 'inbox',
    } as ContactType;
  }, [contactsByInboxId, contactsByAddress, groupMemberProfiles]);

  const visibleMessages = useMemo(() => {
    if (!farcasterFilters.enabled || !conversation) {
      return messages;
    }

    return messages.filter((message) => {
      const senderLower = message.sender?.toLowerCase?.();
      let senderContact: ContactType | null | undefined = null;

      if (conversation.isGroup && senderLower) {
        senderContact = resolveContactForSender(senderLower);
      } else if (!conversation.isGroup) {
        senderContact = contact;
      }

      if (!senderContact && senderLower) {
        senderContact = contactsByInboxId.get(senderLower) || contactsByAddress.get(senderLower);
      }

      return evaluateContactAgainstFilters(senderContact, farcasterFilters).passes;
    });
  }, [
    messages,
    farcasterFilters,
    conversation,
    resolveContactForSender,
    contact,
    contactsByInboxId,
    contactsByAddress,
  ]);

  const messagesToDisplay = farcasterFilters.enabled ? visibleMessages : messages;
  const showFilteredEmpty =
    farcasterFilters.enabled && hasLoadedConversation && messages.length > 0 && visibleMessages.length === 0;
  const showVisibleEmpty = !showInitialLoading && messagesToDisplay.length === 0 && hasLoadedConversation;

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-slate-400 mb-4">Conversation not found</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Back to Chats
          </button>
        </div>
      </div>
    );
  }

  const renderAvatar = (avatar: string | undefined, fallback: string) => {
    const safeAvatar = sanitizeImageSrc(avatar);
    if (safeAvatar) {
      return <img src={safeAvatar} alt="Conversation avatar" className="w-full h-full rounded-full object-cover" />;
    }
    if (avatar) {
      return <span className="text-lg" aria-hidden>{avatar}</span>;
    }
    const label = fallback.startsWith('0x') && fallback.length > 6
      ? fallback.slice(2, 4).toUpperCase()
      : fallback.slice(0, 2).toUpperCase();
    return <span className="text-white font-semibold" aria-hidden>{label}</span>;
  };

  const handleSend = async (content: string) => {
    if (!id) return;
    await sendMessage(id, content, replyTo ? { replyToId: replyTo.id } : undefined);
  };

  const handleSendAttachment = async (file: File) => {
    if (!id) return;
    await sendAttachment(id, file);
  };

  return (
    <div className="flex flex-col h-full text-primary-50">
      {/* Header */}
      <div className="bg-primary-950/70 border-b border-primary-800/60 px-4 py-3 flex items-center gap-3 backdrop-blur-md">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {conversation.isGroup ? (
          <>
            <button
              onClick={() => navigate(`/chat/${conversation.id}/settings`)}
              className="w-10 h-10 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-accent-400 transition-all"
              title="Group Settings"
            >
              {conversationAvatar ? (
                renderAvatar(conversationAvatar, conversation.groupName || 'Group')
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.146-1.28-.422-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.146-1.28.422-1.857m0 0a5 5 0 019.156 0M12 10a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 0 10-6 0 3 3 0 6 0z" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0 text-left flex items-center justify-between">
              <h2 className="font-semibold truncate text-primary-50">{conversationDisplayName}</h2>
              {isCurrentUserAdmin && (
                <button
                  onClick={() => navigate(`/chat/${conversation.id}/settings`)}
                  className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
                  title="Group Settings"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                if (conversationContact) {
                  setContactForModal(conversationContact);
                }
              }}
              className="w-10 h-10 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-accent-400 transition-all"
            >
              {renderAvatar(conversationAvatar, inboxIdForActions)}
            </button>

            <button
              onClick={() => {
                if (conversationContact) {
                  setContactForModal(conversationContact);
                }
              }}
              className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-2">
                <h2 className="font-semibold truncate text-primary-50">{conversationDisplayName}</h2>
                <AddContactButton
                  inboxId={conversation.peerId}
                  primaryAddress={contact?.primaryAddress}
                  fallbackName={conversationDisplayName}
                />
              </div>
              <p className="text-xs text-primary-300">XMTP messaging</p>
            </button>
          </>
        )}
        {conversation.isGroup ? (
          <Menu as="div" className="relative inline-block text-left z-[9999]">
            <Menu.Button className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Portal>
                <Menu.Items className="fixed right-2 top-14 z-[10000] w-56 origin-top-right rounded-lg border border-primary-800/60 bg-primary-950/95 p-2 text-sm shadow-2xl backdrop-blur">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => setInviteModalOpen(true)}
                        className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                      >
                        Create invite
                      </button>
                    )}
                  </Menu.Item>
                  <div className="my-1 h-px bg-primary-800/60" />
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this group? It will be removed locally and ignored during future resyncs.')) return;
                          try {
                            await deleteGroup(conversation.id);
                          } catch (e) {
                            console.warn('[ConversationView] Failed to delete local group data', e);
                          }
                          navigate('/');
                        }}
                        className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-red-900/40 text-red-200' : 'text-red-300'}`}
                      >
                        Delete group
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Portal>
            </Transition>
          </Menu>
        ) : (
          <Menu as="div" className="relative inline-block text-left z-[9999]">
            <Menu.Button className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Portal>
                <Menu.Items className="fixed right-2 top-14 z-[10000] w-56 origin-top-right rounded-lg border border-primary-800/60 bg-primary-950/95 p-2 text-sm shadow-2xl backdrop-blur">
                  {/* Add/Remove Contact */}
                  <Menu.Item>
                    {({ active }) => (
                      isContact(conversation.peerId) ? (
                        <button
                          onClick={async () => {
                            try {
                              await useContactStore.getState().removeContact(conversation.peerId);
                            } catch (e) {
                              alert('Failed to remove contact');
                            }
                          }}
                          className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                        >
                          Remove from contacts
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            try {
                              await useContactStore.getState().upsertContactProfile({
                                inboxId: conversation.peerId,
                                displayName: conversationDisplayName,
                                avatarUrl: conversationAvatar,
                                source: 'inbox',
                                metadata: { createdAt: Date.now() },
                              });
                            } catch (e) {
                              alert('Failed to add contact');
                            }
                          }}
                          className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                        >
                          Add to contacts
                        </button>
                      )
                    )}
                  </Menu.Item>
                  {/* Block/Unblock */}
                  <Menu.Item>
                    {({ active }) => (
                      (contactsByInboxId.get(conversation.peerId.toLowerCase())?.isBlocked) ? (
                        <button
                          onClick={async () => {
                            try {
                              await useContactStore.getState().unblockContact(conversation.peerId);
                            } catch (e) {
                              alert('Failed to unblock');
                            }
                          }}
                          className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                        >
                          Unblock user
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            try {
                              await useContactStore.getState().blockContact(conversation.peerId);
                            } catch (e) {
                              alert('Failed to block');
                            }
                          }}
                          className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                        >
                          Block user
                        </button>
                      )
                    )}
                  </Menu.Item>
                  {/* Mute/Unmute */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={async () => {
                          try { await toggleMute(conversation.id); } catch (_e) { /* ignore */ }
                        }}
                        className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                      >
                        {(conversation.mutedUntil && conversation.mutedUntil > Date.now()) ? 'Unmute' : 'Mute'} conversation
                      </button>
                    )}
                  </Menu.Item>
                  <div className="my-1 h-px bg-primary-800/60" />
                  {/* Delete conversation locally */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this conversation? It will be removed locally and ignored during future resyncs.')) return;
                          try {
                            await hideConversation(conversation.id);
                          } catch (e) {
                            alert('Failed to delete conversation');
                            return;
                          }
                          navigate('/');
                        }}
                        className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-red-900/40 text-red-200' : 'text-red-300'}`}
                      >
                        Delete conversation
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Portal>
            </Transition>
          </Menu>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 bg-primary-950/30"
      >
        {isLoadingOlder && (
          <div className="flex items-center justify-center py-2 text-xs text-primary-300">
            Loading older messages...
          </div>
        )}
        {isRefreshing && (
          <div className="flex items-center justify-center py-2 text-sm text-primary-300">
            <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Syncing messages...
          </div>
        )}
        {showInitialLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-primary-200">Loading messages...</div>
          </div>
        ) : showFilteredEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
            <div className="w-14 h-14 bg-accent-900/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-primary-200">Messages filtered</p>
            <p className="text-sm text-primary-300">Adjust Farcaster filters in Settings to see hidden messages.</p>
          </div>
        ) : showVisibleEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-primary-900/60 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="text-primary-200">No messages yet</p>
            <p className="text-sm text-primary-300 mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          <>
            {messagesToDisplay.map((message: Message) => {
              const senderLower = message.sender?.toLowerCase?.();
              let senderInfo: { displayName?: string; avatarUrl?: string; fallback?: string } | undefined;
              let isSelf = false;

              if (conversation.isGroup && senderLower) {
                const myInboxLower = identity?.inboxId?.toLowerCase();
                const myAddressLower = identity?.address?.toLowerCase();
                isSelf =
                  ((myInboxLower ? senderLower === myInboxLower : false) ||
                    (myAddressLower ? senderLower === myAddressLower : false));

                if (isSelf) {
                  const fallback = identity?.displayName || 'You';
                  senderInfo = {
                    displayName: identity?.displayName || 'You',
                    avatarUrl: identity?.avatar,
                    fallback,
                  };
                } else {
                  const profile = groupMemberProfiles.get(senderLower);
                  let displayName = profile?.displayName;
                  let avatarUrl = profile?.avatar;
                  let fallback = profile?.address || senderLower;

                  if (!profile) {
                    const contactByInbox = contactsByInboxId.get(senderLower);
                    if (contactByInbox) {
                      displayName = contactByInbox.preferredName || contactByInbox.name;
                      avatarUrl = contactByInbox.preferredAvatar || contactByInbox.avatar;
                      fallback = contactByInbox.primaryAddress || senderLower;
                    } else {
                      const contactByAddress = contactsByAddress.get(senderLower);
                      if (contactByAddress) {
                        displayName = contactByAddress.preferredName || contactByAddress.name;
                        avatarUrl = contactByAddress.preferredAvatar || contactByAddress.avatar;
                        fallback = contactByAddress.primaryAddress || senderLower;
                      }
                    }
                  }

                  const resolvedFallback = fallback || senderLower;
                  senderInfo = {
                    displayName: displayName || formatIdentifier(resolvedFallback),
                    avatarUrl,
                    fallback: resolvedFallback,
                  };
                }
              }

              const senderContact =
                conversation.isGroup && senderLower && !isSelf
                  ? resolveContactForSender(senderLower)
                  : null;

              const handleAvatarClick = senderContact
                ? () => {
                  setContactForModal(senderContact);
                }
                : undefined;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onReplyRequest={(m) => setReplyTo(m)}
                  senderInfo={senderInfo}
                  showAvatar={Boolean(conversation.isGroup)}
                  showSenderLabel={Boolean(conversation.isGroup)}
                  onSenderClick={handleAvatarClick}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div ref={composerRef}>
        {conversation?.isGroup && !isGroupMember ? (
          <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg px-4 py-3 text-sm text-primary-200">
            You are no longer a member of this group and cannot send new messages.
          </div>
        ) : (
          <MessageComposer
            onSend={handleSend}
            onSendAttachment={handleSendAttachment}
            replyToMessage={replyTo ?? undefined}
            onCancelReply={() => setReplyTo(null)}
            onSent={() => setReplyTo(null)}
            mentionCandidates={mentionCandidates}
          />
        )}
      </div>

      {/* User info modal */}
      {contactForModal && (
        <ContactCardModal contact={contactForModal} onClose={() => setContactForModal(null)} />
      )}
      {isInviteModalOpen && conversation?.isGroup && (
        <GroupInviteModal
          conversationId={conversation.id}
          conversationName={conversationDisplayName}
          onClose={() => setInviteModalOpen(false)}
        />
      )}
    </div>
  );
}
