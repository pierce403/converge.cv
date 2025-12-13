import { useState, useEffect } from 'react';
import { useContactStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import type { Contact, ContactIdentity } from '@/lib/stores/contact-store';
import type { Conversation } from '@/types';
import { QRCodeOverlay } from './QRCodeOverlay';
import { useConversations } from '@/features/conversations/useConversations';
import { useConversationStore } from '@/lib/stores';
import { useFarcasterStore } from '@/lib/stores/farcaster-store';
import { useNavigate } from 'react-router-dom';
import { isEthereumAddress, resolveENS, resolveENSFromAddress } from '@/lib/utils/ens';
import { getStorage } from '@/lib/storage';
import { fetchNeynarUserByVerification, fetchNeynarUserProfile } from '@/lib/farcaster/neynar';

interface ContactCardModalProps {
  contact: Contact;
  onClose: () => void;
}

interface InboxState {
  inboxId: string;
  accountAddresses: string[]; // Extracted from identifiers
}

const formatIdentifier = (value?: string | null): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();
  if (lower.startsWith('0x') && lower.length > 10) {
    return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
  }
  if (raw.length > 18) {
    return `${raw.slice(0, 10)}…${raw.slice(-4)}`;
  }
  return raw;
};

export function ContactCardModal({ contact, onClose }: ContactCardModalProps) {
  const updateContact = useContactStore((state) => state.updateContact);
  const upsertContactProfile = useContactStore((state) => state.upsertContactProfile);
  const addContact = useContactStore((s) => s.addContact);
  const removeContact = useContactStore((s) => s.removeContact);
  const isContact = useContactStore((s) => s.isContact);
  const [showQR, setShowQR] = useState(false);
  const [preferredName, setPreferredName] = useState(contact.preferredName || '');
  const [avatarUrlState, setAvatarUrlState] = useState<string | undefined>(
    contact.preferredAvatar || contact.avatar
  );
  const [notes, setNotes] = useState(contact.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [inboxState, setInboxState] = useState<InboxState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { createConversation, toggleMute } = useConversations();
  const conversations = useConversationStore((s) => s.conversations);
  const updateConversationInStore = useConversationStore((s) => s.updateConversation);
  const farcasterStore = useFarcasterStore();
  const navigate = useNavigate();

  // Use live contact from store to ensure reactivity (e.g. after refresh)
  const contacts = useContactStore((s) => s.contacts);
  const liveContact = contacts.find((c) =>
    c.inboxId?.toLowerCase() === contact.inboxId?.toLowerCase()
  ) ?? contact;

  useEffect(() => {
    setPreferredName(contact.preferredName || '');
    setNotes(contact.notes || '');
    setAvatarUrlState(contact.preferredAvatar || contact.avatar);
    // Load existing inbox state if available
    if (contact.inboxId) {
      loadInboxState(contact.inboxId);
    }
  }, [contact]);

  const loadInboxState = async (inboxId: string) => {
    try {
      const looksLikeInboxId = (value: string): boolean => {
        const v = value.trim().toLowerCase();
        if (!v || v.startsWith('0x') || v.includes('.') || v.includes('@') || v.includes(' ')) return false;
        return v.length >= 10 && /^[a-z0-9_-]+$/.test(v);
      };
      if (!looksLikeInboxId(inboxId)) {
        // Skip identity service calls for ENS-like or obviously non-inbox inputs
        return;
      }
      type SafeInboxStateLite = {
        inboxId: string;
        identifiers?: Array<{ identifierKind: string; identifier: string }>;
      };
      const { getXmtpUtils } = await import('@/lib/xmtp/utils-singleton');
      const utils = await getXmtpUtils();
      const states = (await utils.inboxStateFromInboxIds([inboxId], 'production')) as unknown as SafeInboxStateLite[];
      const state = states[0];
      if (state) {
        // Extract Ethereum addresses from identifiers
        const accountAddresses = (state.identifiers || [])
          .filter((id) => id.identifierKind.toLowerCase() === 'ethereum')
          .map((id) => {
            const identifier = id.identifier;
            return identifier.startsWith('0x') ? identifier : `0x${identifier}`;
          });
        setInboxState({
          inboxId: state.inboxId,
          accountAddresses,
        });
      }
    } catch (error) {
      console.error('Failed to load inbox state:', error);
    }
  };

  const handleToggleContact = async () => {
    const inContacts = isContact(contact.inboxId);
    if (inContacts) {
      if (confirm('Remove this contact?')) {
        await removeContact(contact.inboxId);
        alert('Removed from contacts');
      }
    } else {
      await addContact({
        ...contact,
        createdAt: contact.createdAt || Date.now(),
        isInboxOnly: true,
        source: contact.source ?? 'inbox',
      } as Contact);
      alert('Added to contacts');
    }
  };

  const handleRefreshInbox = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const xmtp = getXmtpClient();
      // Proceed even if not connected, to allow Farcaster/ENS updates
      const isXmtpConnected = xmtp.isConnected();

      const normalize = (value: string) => value.trim().toLowerCase();
      const looksLikeRawHex = (value: string) => /^[0-9a-f]{40}$/i.test(value);

      const ethereumAddresses = new Set<string>();
      const nonEthereumAddresses = new Set<string>();
      const addAddress = (value?: string | null) => {
        if (!value) return;
        const trimmed = value.trim();
        if (!trimmed) return;
        if (isEthereumAddress(trimmed)) {
          ethereumAddresses.add(normalize(trimmed));
        } else if (looksLikeRawHex(trimmed)) {
          ethereumAddresses.add(`0x${normalize(trimmed)}`);
        } else {
          nonEthereumAddresses.add(normalize(trimmed));
        }
      };

      const otherIdentities = new Map<string, ContactIdentity>();
      let ensIdentity: ContactIdentity | undefined = contact.identities?.find(
        (identity) => identity.kind?.toLowerCase() === 'ens'
      );
      const ingestIdentity = (identity: ContactIdentity | undefined) => {
        if (!identity?.identifier || !identity.kind) return;
        const kindLower = identity.kind.toLowerCase();
        if (kindLower === 'ethereum') {
          addAddress(identity.identifier);
          return;
        }
        if (kindLower === 'ens') {
          ensIdentity = { ...identity };
          return;
        }
        const key = `${kindLower}::${normalize(identity.identifier)}`;
        const existing = otherIdentities.get(key);
        otherIdentities.set(key, existing ? { ...existing, ...identity } : { ...identity });
      };

      addAddress(contact.primaryAddress);
      addAddress(contact.inboxId);
      contact.addresses?.forEach(addAddress);
      inboxState?.accountAddresses?.forEach(addAddress);
      contact.identities?.forEach((identity) => ingestIdentity(identity));

      const conversationMatch = conversations.find(
        (c) => !c.isGroup && c.peerId?.toLowerCase?.() === contact.inboxId?.toLowerCase?.()
      );

      const initialPriority: 'farcaster' | 'xmtp' | 'message' =
        contact.source === 'farcaster' || contact.farcasterFid || contact.farcasterUsername
          ? 'farcaster'
          : 'xmtp';

      let latestProfileDisplayName =
        contact.preferredName ??
        contact.name ??
        conversationMatch?.displayName;
      let latestProfileAvatar = contact.preferredAvatar ?? contact.avatar ?? conversationMatch?.displayAvatar;
      let namePriority: 'message' | 'farcaster' | 'ens' | 'xmtp' = initialPriority;
      let avatarPriority: 'message' | 'farcaster' | 'ens' | 'xmtp' = initialPriority;

      const preferName = (
        next: string | null | undefined,
        priority: 'farcaster' | 'ens' | 'xmtp' | 'message'
      ) => {
        if (!next) return;
        const rank = { farcaster: 3, ens: 2, xmtp: 1, message: 0 } as const;
        if (rank[priority] >= rank[namePriority]) {
          latestProfileDisplayName = next;
          namePriority = priority;
        }
      };

      const preferAvatar = (
        next: string | null | undefined,
        priority: 'farcaster' | 'ens' | 'xmtp' | 'message'
      ) => {
        if (!next) return;
        const rank = { farcaster: 3, ens: 2, xmtp: 1, message: 0 } as const;
        if (rank[priority] >= rank[avatarPriority]) {
          latestProfileAvatar = next;
          avatarPriority = priority;
        }
      };

      const ingestProfile = (profile: Awaited<ReturnType<typeof xmtp.fetchInboxProfile>> | null) => {
        if (!profile) return;
        if (profile.displayName) {
          latestProfileDisplayName = profile.displayName;
        }
        if (profile.avatarUrl) {
          latestProfileAvatar = profile.avatarUrl;
        }
        addAddress(profile.primaryAddress);
        profile.addresses?.forEach(addAddress);
        profile.identities?.forEach((identity) =>
          ingestIdentity({
            identifier: identity.identifier,
            kind: identity.kind,
            isPrimary: identity.isPrimary,
          })
        );
        if (!ensIdentity) {
          const profileEns = profile.identities?.find((id) => id.kind?.toLowerCase() === 'ens');
          if (profileEns?.identifier) {
            ensIdentity = {
              identifier: profileEns.identifier,
              kind: profileEns.kind ?? 'ENS',
              isPrimary: profileEns.isPrimary,
            };
          }
        }
      };

      // Farcaster first (if available)
      const neynarKey = farcasterStore.getEffectiveNeynarApiKey?.();
      const farcasterFid = contact.farcasterFid;
      const farcasterUsername = contact.farcasterUsername;
      const candidateEthAddresses = Array.from(ethereumAddresses);

      let fcResolvedProfile: (Awaited<ReturnType<typeof fetchNeynarUserProfile>> & { power_badge?: boolean }) | null = null;

      if (neynarKey) {
        try {
          fcResolvedProfile =
            (farcasterFid ? await fetchNeynarUserProfile(farcasterFid, neynarKey) : null) ||
            (farcasterUsername ? await fetchNeynarUserProfile(farcasterUsername, neynarKey) : null);

          if (!fcResolvedProfile && candidateEthAddresses.length > 0) {
            fcResolvedProfile = await fetchNeynarUserByVerification(candidateEthAddresses[0], neynarKey);
          }

          if (fcResolvedProfile) {
            preferName(fcResolvedProfile.username, 'farcaster');
            preferAvatar(fcResolvedProfile.pfp_url, 'farcaster');
          }
        } catch (fcError) {
          console.warn('[ContactCardModal] Farcaster refresh failed:', fcError);
        }
      }

      // ENS second
      if (!ensIdentity) {
        const candidateAddress = Array.from(ethereumAddresses)[0];
        if (candidateAddress) {
          try {
            const ensName = await resolveENSFromAddress(candidateAddress);
            if (ensName) {
              ensIdentity = {
                identifier: ensName,
                kind: 'ENS',
                isPrimary: true,
              };
              preferName(ensName, 'ens');
            }
          } catch (ensError) {
            console.warn('[ContactCardModal] Reverse ENS lookup failed:', ensError);
          }
        }
      }

      let ensResolvedAddress: string | null = null;
      if (ensIdentity?.identifier) {
        try {
          ensResolvedAddress = await resolveENS(ensIdentity.identifier);
          if (ensResolvedAddress && isEthereumAddress(ensResolvedAddress)) {
            ethereumAddresses.add(normalize(ensResolvedAddress));
          }
        } catch (ensLookupError) {
          console.warn('[ContactCardModal] ENS forward resolution failed:', ensLookupError);
        }
      }

      let primaryEthereumAddress: string | undefined;
      if (ensResolvedAddress && isEthereumAddress(ensResolvedAddress)) {
        primaryEthereumAddress = normalize(ensResolvedAddress);
      } else {
        const preferredSources = [
          contact.primaryAddress,
          contact.addresses?.find((addr) => isEthereumAddress(addr ?? '')),
          Array.from(ethereumAddresses)[0],
        ];
        for (const source of preferredSources) {
          if (source && isEthereumAddress(source)) {
            primaryEthereumAddress = normalize(source);
            break;
          }
        }
      }

      if (!primaryEthereumAddress) {
        throw new Error('Unable to determine a valid Ethereum address for this contact.');
      }

      // Resolve inbox ID from the primary Ethereum address
      // Use deriveInboxIdFromAddress which handles offline fallback via Utils
      let latestInboxId: string | undefined;
      try {
        console.log('[ContactCardModal] Resolving Inbox ID for address:', primaryEthereumAddress);
        const resolvedInboxId = await xmtp.deriveInboxIdFromAddress(primaryEthereumAddress);
        if (resolvedInboxId) {
          latestInboxId = normalize(resolvedInboxId);
        } else {
          console.warn('No inbox ID found for this address on the network.');
        }
      } catch (inboxError) {
        console.warn('Failed to resolve XMTP inbox ID from address:', inboxError);
      }

      // XMTP profile last (message history)
      if (isXmtpConnected) {
        try {
          const targetInbox = contact.inboxId || contact.primaryAddress || contact.addresses?.[0];
          if (targetInbox) {
            console.log('[ContactCardModal] Refreshing profile for', targetInbox);
            const profile = await xmtp.fetchInboxProfile(String(targetInbox));
            console.log('[ContactCardModal] fetchInboxProfile result:', profile);
            ingestProfile(profile);
            preferName(profile?.displayName, 'xmtp');
            preferAvatar(profile?.avatarUrl, 'xmtp');
          }
        } catch (e) {
          console.warn('[ContactCardModal] Profile refresh skipped/failed:', e);
        }
      }

      // Fetch canonical profile if inbox ID changed
      if (latestInboxId && latestInboxId !== contact.inboxId?.toLowerCase()) {
        try {
          const canonicalProfile = await xmtp.fetchInboxProfile(latestInboxId);
          ingestProfile(canonicalProfile);
          preferName(canonicalProfile?.displayName, 'xmtp');
          preferAvatar(canonicalProfile?.avatarUrl, 'xmtp');
        } catch (canonicalError) {
          console.warn('[ContactCardModal] Failed to fetch canonical inbox profile:', canonicalError);
        }
      }

      if (ensIdentity) {
        ensIdentity = {
          identifier: ensIdentity.identifier,
          kind: ensIdentity.kind ?? 'ENS',
          isPrimary: true,
        };
      }

      const ethereumAddressList = Array.from(ethereumAddresses);
      ethereumAddressList.sort((a, b) => (a === primaryEthereumAddress ? -1 : b === primaryEthereumAddress ? 1 : 0));
      const mergedAddressList = [...ethereumAddressList, ...Array.from(nonEthereumAddresses)];

      const finalIdentities: ContactIdentity[] = [
        ...ethereumAddressList.map((addr, index) => ({
          identifier: addr,
          kind: 'Ethereum',
          isPrimary: index === 0,
        })),
        ...(ensIdentity ? [ensIdentity] : []),
        ...Array.from(otherIdentities.values()),
      ];

      const isHexAddress = (value?: string | null) =>
        Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));

      let updatedDisplayName = latestProfileDisplayName || ensIdentity?.identifier;
      if (isHexAddress(updatedDisplayName) && contact.name && !isHexAddress(contact.name)) {
        updatedDisplayName = contact.preferredName ?? contact.name;
      }
      const updatedAvatar = latestProfileAvatar;

      const contactStore = useContactStore.getState();
      let normalizedInboxId = latestInboxId;
      const normalizedCurrentInbox = contact.inboxId?.toLowerCase();
      if (normalizedInboxId) {
        const conflicting = contactStore.contacts.find(
          (entry) =>
            entry.inboxId.toLowerCase() === normalizedInboxId && entry.inboxId.toLowerCase() !== normalizedCurrentInbox
        );
        if (conflicting) {
          try {
            await removeContact(conflicting.inboxId);
          } catch (conflictError) {
            console.warn('[ContactCardModal] Failed to remove conflicting contact during refresh:', conflictError);
          }
        }
      }

      if (!normalizedInboxId) {
        // If we couldn't resolve an inboxId (e.g. not connected and contact has none), we might fail to update contact identity
        // safely if we strictly require inboxId.
        // However, we can probably fallback to primaryAddress for display updates if it's existing contact?
        // The upsert function usually requires inboxId.
        // If we have an existing contact, use its ID.
        if (contact.inboxId) {
          normalizedInboxId = normalize(contact.inboxId);
        } else {
          throw new Error('No inbox ID available and unable to resolve one from network (possible timeout). check XMTP connection.');
        }
      }

      const latestMetadata: Partial<Contact> = {
        ...contact,
        inboxId: normalizedInboxId,
        preferredName: contact.preferredName,
        preferredAvatar: contact.preferredAvatar,
        notes: contact.notes,
        farcasterUsername: fcResolvedProfile?.username ?? contact.farcasterUsername,
        farcasterFid: fcResolvedProfile?.fid ?? contact.farcasterFid,
        farcasterScore: fcResolvedProfile?.score ?? contact.farcasterScore,
        farcasterFollowerCount: fcResolvedProfile?.follower_count ?? contact.farcasterFollowerCount,
        farcasterFollowingCount: fcResolvedProfile?.following_count ?? contact.farcasterFollowingCount,
        farcasterActiveStatus: fcResolvedProfile?.active_status ?? contact.farcasterActiveStatus,
        farcasterPowerBadge: fcResolvedProfile?.power_badge ?? contact.farcasterPowerBadge,
      };

      const refreshedContact = await upsertContactProfile({
        inboxId: normalizedInboxId,
        displayName: updatedDisplayName,
        avatarUrl: updatedAvatar,
        primaryAddress: primaryEthereumAddress,
        addresses: mergedAddressList,
        identities: finalIdentities,
        source: contact.source ?? 'inbox',
        metadata: latestMetadata,
      });

      setPreferredName(refreshedContact.preferredName ?? refreshedContact.name ?? '');
      setAvatarUrlState(refreshedContact.preferredAvatar ?? refreshedContact.avatar);

      const displayAvatar =
        refreshedContact.preferredAvatar ?? refreshedContact.avatar ?? updatedAvatar ?? avatarUrlState;
      const displayName =
        refreshedContact.preferredName ?? refreshedContact.name ?? updatedDisplayName ?? contact.name;

      const candidateKeys = new Set(
        [
          normalizedCurrentInbox,
          normalizedInboxId,
          primaryEthereumAddress,
          contact.primaryAddress?.toLowerCase(),
          ...((contact.addresses?.map((addr) => addr?.toLowerCase()).filter(Boolean)) as string[] ?? []),
        ].filter(Boolean)
      );

      const conversationsNeedingUpdate = conversations.filter((conversation) => {
        if (conversation.isGroup) {
          return false;
        }
        const peerLower = conversation.peerId?.toLowerCase?.();
        return peerLower ? candidateKeys.has(peerLower) : false;
      });

      if (conversationsNeedingUpdate.length > 0) {
        const updatesToPersist: Array<{ id: string; updates: Partial<Conversation> }> = [];
        for (const conversation of conversationsNeedingUpdate) {
          const updates: Partial<Conversation> = {};
          if (conversation.peerId.toLowerCase() !== normalizedInboxId) {
            updates.peerId = normalizedInboxId;
          }
          if (displayName && conversation.displayName !== displayName) {
            updates.displayName = displayName;
          }
          if (displayAvatar && conversation.displayAvatar !== displayAvatar) {
            updates.displayAvatar = displayAvatar;
          }
          if (Object.keys(updates).length > 0) {
            updateConversationInStore(conversation.id, updates);
            updatesToPersist.push({ id: conversation.id, updates });
          }
        }
        if (updatesToPersist.length > 0) {
          try {
            const storage = await getStorage();
            for (const { id, updates } of updatesToPersist) {
              const original = conversations.find((conversation) => conversation.id === id);
              if (original) {
                await storage.putConversation({ ...original, ...updates });
              }
            }
          } catch (persistError) {
            console.warn('[ContactCardModal] Failed to persist conversation updates:', persistError);
          }
        }
      }

      setInboxState({
        inboxId: normalizedInboxId,
        accountAddresses: ethereumAddressList,
      });

      // Refresh linked identities from XMTP identity service
      type SafeInboxStateLite = {
        inboxId: string;
        identifiers?: Array<{ identifierKind: string; identifier: string }>;
      };
      const looksLikeInboxId = (value: string): boolean => {
        const v = value.trim().toLowerCase();
        if (!v || v.startsWith('0x') || v.includes('.') || v.includes('@') || v.includes(' ')) return false;
        return v.length >= 10 && /^[a-z0-9_-]+$/.test(v);
      };
      if (looksLikeInboxId(normalizedInboxId)) {
        try {
          const { getXmtpUtils } = await import('@/lib/xmtp/utils-singleton');
          const utils = await getXmtpUtils();
          const states = (await utils.inboxStateFromInboxIds([normalizedInboxId], 'production')) as unknown as SafeInboxStateLite[];
          const state = states[0];
          if (state) {
            const accountAddresses = (state.identifiers || [])
              .filter((id) => id.identifierKind.toLowerCase() === 'ethereum')
              .map((id) => {
                const identifier = id.identifier;
                return identifier.startsWith('0x') ? identifier : `0x${identifier}`;
              });
            setInboxState({
              inboxId: state.inboxId,
              accountAddresses,
            });
            const normalizedAccountAddresses = accountAddresses.map((addr) =>
              addr.startsWith('0x') ? addr.toLowerCase() : `0x${addr.toLowerCase()}`
            );
            const refreshedIdentities: ContactIdentity[] = [
              ...normalizedAccountAddresses.map((addr, index) => ({
                identifier: addr,
                kind: 'Ethereum',
                isPrimary: index === 0,
              })),
              ...(ensIdentity ? [ensIdentity] : []),
              ...Array.from(otherIdentities.values()),
            ];
            await upsertContactProfile({
              inboxId: normalizedInboxId,
              primaryAddress: normalizedAccountAddresses[0] ?? primaryEthereumAddress,
              addresses:
                normalizedAccountAddresses.length > 0
                  ? [...normalizedAccountAddresses, ...Array.from(nonEthereumAddresses)]
                  : mergedAddressList,
              identities: refreshedIdentities,
              source: contact.source ?? 'inbox',
              metadata: latestMetadata,
            });
          }
        } catch (stateError) {
          console.warn('[ContactCardModal] Failed to refresh inbox state identities:', stateError);
        }
      }
    } catch (error) {
      console.error('Failed to refresh inbox:', error);
      setRefreshError(error instanceof Error ? error.message : 'Failed to refresh inbox');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const targetInboxId = contact.inboxId ?? contact.primaryAddress ?? contact.addresses?.[0];
      if (!targetInboxId) {
        throw new Error('Unable to resolve inbox ID for contact update');
      }
      await updateContact(targetInboxId, { preferredName, notes });
      onClose();
    } catch (error) {
      console.error('Failed to save contact details:', error);
      alert('Failed to save contact details. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  };

  const handleMessage = async () => {
    try {
      const conv = await createConversation(contact.inboxId);
      if (conv) {
        navigate(`/chat/${conv.id}`);
        onClose();
      }
    } catch (error) {
      console.error('Failed to open conversation:', error);
    }
  };

  const dmConversation = conversations.find((c) => !c.isGroup && c.peerId.toLowerCase() === contact.inboxId.toLowerCase());
  const isMuted = Boolean(dmConversation?.mutedUntil && dmConversation.mutedUntil > Date.now());

  // Determine display name with priority
  const displayName = preferredName || liveContact.name || formatIdentifier(liveContact.inboxId);

  // Determine avatar (custom > Farcaster)
  const avatarUrl = avatarUrlState;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="bg-primary-900 rounded-lg shadow-xl w-full max-w-md p-6 relative text-primary-50 my-8"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-full hover:bg-primary-800 transition-colors"
          >
            <svg className="w-6 h-6 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-2xl font-bold mb-6 text-center">Contact Details</h2>

          <div className="flex flex-col items-center mb-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-primary-700 flex items-center justify-center text-4xl font-bold text-primary-50 mb-4">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Contact Avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>

            {/* Display Name */}
            <h3 className="text-xl font-semibold mb-2">{displayName}</h3>
            {liveContact.preferredName && liveContact.preferredName !== liveContact.name && (
              <p className="text-primary-300 text-sm mb-4">Also known as: {liveContact.name}</p>
            )}

            {(liveContact.farcasterUsername || liveContact.farcasterFid) && (
              <div className="flex flex-col items-center gap-1 mb-4 text-sm text-primary-200">
                {liveContact.farcasterUsername && (
                  <a
                    href={`https://farcaster.xyz/${liveContact.farcasterUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-accent-400 hover:text-accent-300 underline"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on Farcaster
                  </a>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {liveContact.farcasterScore !== undefined && liveContact.farcasterScore !== null && (
                    <span className="px-2 py-1 rounded bg-accent-900/40 text-accent-200 border border-accent-800/60">
                      Neynar score: {liveContact.farcasterScore.toFixed(1)}
                    </span>
                  )}
                  {liveContact.farcasterFollowerCount !== undefined && (
                    <span className="px-2 py-1 rounded bg-primary-800/50 text-primary-200 border border-primary-700/60">
                      Followers: {liveContact.farcasterFollowerCount}
                    </span>
                  )}
                  {liveContact.farcasterFollowingCount !== undefined && (
                    <span className="px-2 py-1 rounded bg-primary-800/50 text-primary-200 border border-primary-700/60">
                      Following: {liveContact.farcasterFollowingCount}
                    </span>
                  )}
                  {liveContact.farcasterPowerBadge && (
                    <span className="px-2 py-1 rounded bg-accent-950/60 text-accent-200 border border-accent-900/70">
                      Power Badge
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Display Name Input */}
            <div className="w-full mb-4">
              <label htmlFor="preferredName" className="block text-sm font-medium text-primary-300 mb-1">
                Display Name
              </label>
              <input
                id="preferredName"
                type="text"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                className="input-primary w-full"
                placeholder="Enter display name"
              />
            </div>

            {/* Mute toggle if DM exists */}
            {dmConversation && (
              <div className="w-full mb-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-primary-300">Mute conversation</label>
                  <button
                    onClick={async () => {
                      try { await toggleMute(dmConversation.id); } catch (_e) { /* ignore */ }
                    }}
                    className={`px-3 py-1 rounded ${isMuted ? 'bg-primary-800 text-primary-100' : 'bg-primary-900 text-primary-300 hover:bg-primary-800'}`}
                  >
                    {isMuted ? 'Unmute' : 'Mute'}
                  </button>
                </div>
                <p className="text-xs text-primary-400 mt-1">{isMuted ? 'Muted' : 'Not muted'}</p>
              </div>
            )}

            {/* Inbox ID Section */}
            <div className="w-full mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-primary-300">Inbox ID</label>
                <button
                  onClick={handleRefreshInbox}
                  disabled={isRefreshing}
                  className="text-xs px-2 py-1 rounded bg-accent-900/50 text-accent-300 hover:bg-accent-800/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {isRefreshing ? (
                    <>
                      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </>
                  )}
                </button>
              </div>
              {refreshError && (
                <p className="text-red-400 text-xs mb-2">{refreshError}</p>
              )}
              <div className="flex items-center bg-primary-800 rounded-lg p-2">
                <span className="flex-1 text-primary-50 text-sm truncate font-mono">
                  {inboxState?.inboxId || contact.inboxId || contact.primaryAddress || 'Unknown'}
                </span>
                <button
                  onClick={() =>
                    handleCopy(
                      inboxState?.inboxId || contact.inboxId || contact.primaryAddress || '',
                      'Inbox ID'
                    )
                  }
                  className="ml-2 p-1 rounded-md hover:bg-primary-700 transition-colors"
                  title="Copy Inbox ID"
                >
                  <svg className="w-5 h-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Known Connected Identities */}
            <div className="w-full mb-6">
              <h3 className="text-lg font-semibold text-primary-50 mb-2">Known Connected Identities</h3>
              {inboxState && inboxState.accountAddresses.length > 0 ? (
                <div className="space-y-2">
                  {inboxState.accountAddresses.map((address, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-primary-800 rounded-lg p-2"
                    >
                      <span className="flex-1 text-primary-50 text-sm truncate font-mono">{address}</span>
                      <button
                        onClick={() => handleCopy(address, 'Address')}
                        className="ml-2 p-1 rounded-md hover:bg-primary-700 transition-colors"
                        title="Copy Address"
                      >
                        <svg className="w-4 h-4 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-primary-300 text-sm">
                  {isRefreshing ? 'Loading identities...' : 'Click Refresh to load connected identities'}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="w-full mb-6">
              <label htmlFor="notes" className="block text-sm font-medium text-primary-300 mb-1">
                Notes (max 500 chars)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={4}
                className="input-primary w-full resize-none"
                placeholder="Add notes about this contact..."
              />
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSave}
                className="btn-primary w-full"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setShowQR(true)}
                className="btn-secondary w-full"
              >
                Show QR Code
              </button>
              <button
                onClick={handleToggleContact}
                className="btn-secondary w-full"
              >
                {isContact(contact.inboxId) ? 'Remove from Contacts' : 'Add to Contacts'}
              </button>
              <button
                onClick={handleMessage}
                className="btn-secondary w-full"
              >
                Message
              </button>
            </div>
          </div>
        </div>
      </div>
      {showQR && (
        <QRCodeOverlay address={contact.inboxId} onClose={() => setShowQR(false)} />
      )}
    </>
  );
}
