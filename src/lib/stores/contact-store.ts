import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import {
  hasEthereumHexPrefix,
  isEthereumAddress,
  normalizeEthereumAddress,
} from '@/lib/utils/ethereum';

const normalizeInboxId = (inboxId: string): string =>
  normalizeEthereumAddress(inboxId) ?? inboxId.trim().toLowerCase();

const normalizeAddress = (address: string): string =>
  normalizeEthereumAddress(address) ?? address.trim().toLowerCase();

const isAddressLikeInboxId = (value: string): boolean => {
  const trimmed = value.trim();
  return Boolean(trimmed && (normalizeEthereumAddress(trimmed) || hasEthereumHexPrefix(trimmed)));
};

const normalizeContactAddress = (value?: string | null): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  const ethereumAddress = normalizeEthereumAddress(trimmed);
  if (ethereumAddress) return ethereumAddress;
  // Never retain malformed values that claim to be hexadecimal Ethereum addresses.
  if (hasEthereumHexPrefix(trimmed)) return null;
  return trimmed.toLowerCase();
};

const sanitizeDisplayLabel = (value?: string | null): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  if (isEthereumAddress(trimmed)) return undefined;
  return trimmed;
};

const dedupe = (values: (string | undefined | null)[]): string[] => {
  const set = new Set<string>();
  for (const value of values) {
    if (value) {
      set.add(value);
    }
  }
  return Array.from(set);
};

const normalizeContactAddresses = (values: (string | undefined | null)[]): string[] =>
  dedupe(values.map((value) => normalizeContactAddress(value)));

export interface ContactIdentity {
  identifier: string;
  kind: string;
  displayLabel?: string;
  isPrimary?: boolean;
}

export interface Contact {
  inboxId: string;
  name: string;
  avatar?: string;
  description?: string;
  preferredName?: string;
  preferredAvatar?: string;
  notes?: string;
  createdAt: number;
  source?: 'farcaster' | 'inbox' | 'manual';
  isBlocked?: boolean;
  isInboxOnly?: boolean;
  primaryAddress?: string;
  addresses?: string[];
  identities?: ContactIdentity[];
  farcasterUsername?: string;
  farcasterFid?: number;
  farcasterScore?: number;
  farcasterFollowerCount?: number;
  farcasterFollowingCount?: number;
  farcasterActiveStatus?: string;
  farcasterPowerBadge?: boolean;
  lastSyncedAt?: number;
}

const normalizeContactIdentity = (identity: ContactIdentity): ContactIdentity | null => {
  const identifier = identity.identifier?.trim();
  const kind = identity.kind?.trim();
  if (!identifier || !kind) return null;

  if (kind.toLowerCase() === 'ethereum') {
    const ethereumAddress = normalizeEthereumAddress(identifier);
    if (!ethereumAddress) return null;
    return { ...identity, identifier: ethereumAddress, kind: 'Ethereum' };
  }

  return { ...identity, identifier, kind };
};

const normalizeContactIdentities = (identities: ContactIdentity[]): ContactIdentity[] => {
  const normalized = new Map<string, ContactIdentity>();
  for (const rawIdentity of identities) {
    const identity = normalizeContactIdentity(rawIdentity);
    if (!identity) continue;
    const key = `${identity.kind.toLowerCase()}::${identity.identifier.toLowerCase()}`;
    const existing = normalized.get(key);
    normalized.set(key, existing ? { ...existing, ...identity } : identity);
  }
  return Array.from(normalized.values());
};

const ethereumIdentitiesFromAddresses = (addresses: string[]): ContactIdentity[] =>
  addresses.flatMap((address) => {
    const normalized = normalizeEthereumAddress(address);
    return normalized ? [{ identifier: normalized, kind: 'Ethereum' }] : [];
  }).map((identity, index) => ({ ...identity, isPrimary: index === 0 }));

type ContactUpdates = Partial<Omit<Contact, 'inboxId' | 'identities' | 'addresses'>> & {
  identities?: ContactIdentity[];
  addresses?: string[];
};

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  addContact: (contact: Contact) => Promise<void>;
  removeContact: (inboxId: string) => Promise<void>;
  updateContact: (inboxId: string, updates: ContactUpdates) => Promise<void>;
  loadContacts: () => Promise<void>;
  isContact: (inboxId: string) => boolean;
  getContactByInboxId: (inboxId: string) => Contact | undefined;
  getContactByAddress: (address: string) => Contact | undefined;
  upsertContactProfile: (profile: ContactProfileInput) => Promise<Contact>;
  blockContact: (inboxId: string) => Promise<void>;
  unblockContact: (inboxId: string) => Promise<void>;
}

export interface ContactProfileInput {
  inboxId: string;
  displayName?: string;
  avatarUrl?: string;
  primaryAddress?: string;
  addresses?: string[];
  identities?: ContactIdentity[];
  source?: 'farcaster' | 'inbox' | 'manual';
  metadata?: Partial<Contact>;
  /** Only deliberate participation/Add Contact actions may create a new row. */
  persistIfMissing?: boolean;
}

const mergeContactData = (existing: Contact, updates: ContactUpdates): Contact => {
  const addresses = normalizeContactAddresses([
    ...(updates.addresses ?? []),
    ...(existing.addresses ?? []),
    existing.primaryAddress,
    updates.primaryAddress,
  ]);

  const identities = (() => {
    const merged = normalizeContactIdentities(existing.identities ?? []);
    const incoming = normalizeContactIdentities(updates.identities ?? []);
    for (const identity of incoming) {
      const idx = merged.findIndex(
        (entry) =>
          entry.identifier.toLowerCase() === identity.identifier.toLowerCase() &&
          entry.kind.toLowerCase() === identity.kind.toLowerCase()
      );
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...identity };
      } else {
        merged.push(identity);
      }
    }
    return merged;
  })();

  return {
    ...existing,
    ...updates,
    name:
      sanitizeDisplayLabel(updates.name) ??
      sanitizeDisplayLabel(existing.name) ??
      sanitizeDisplayLabel(updates.preferredName) ??
      sanitizeDisplayLabel(existing.preferredName) ??
      '',
    avatar: updates.avatar ?? existing.avatar ?? updates.preferredAvatar ?? existing.preferredAvatar,
    // Legacy private aliases, avatar overrides, and notes are intentionally discarded.
    preferredName: undefined,
    preferredAvatar: undefined,
    notes: undefined,
    addresses,
    identities,
    primaryAddress:
      normalizeContactAddress(updates.primaryAddress) ??
      normalizeContactAddress(existing.primaryAddress) ??
      addresses[0],
    farcasterUsername: updates.farcasterUsername ?? existing.farcasterUsername,
    farcasterFid: updates.farcasterFid ?? existing.farcasterFid,
    farcasterScore: updates.farcasterScore ?? existing.farcasterScore,
    farcasterFollowerCount: updates.farcasterFollowerCount ?? existing.farcasterFollowerCount,
    farcasterFollowingCount: updates.farcasterFollowingCount ?? existing.farcasterFollowingCount,
    farcasterActiveStatus: updates.farcasterActiveStatus ?? existing.farcasterActiveStatus,
    farcasterPowerBadge: updates.farcasterPowerBadge ?? existing.farcasterPowerBadge,
  };
};

type LegacyContact = Contact & { address?: string };

const deriveInboxId = (contact: LegacyContact): string | null => {
  if (contact.inboxId) {
    return contact.inboxId;
  }

  if (typeof contact.address === 'string' && contact.address.trim().length > 0) {
    return contact.address;
  }

  if (contact.primaryAddress && contact.primaryAddress.trim().length > 0) {
    return contact.primaryAddress;
  }

  const firstAddress = contact.addresses?.find((entry) => Boolean(entry?.trim()));
  if (firstAddress) {
    return firstAddress;
  }

  return null;
};

const normaliseContactInput = (contact: LegacyContact): Contact => {
  const derivedInboxId = deriveInboxId(contact);
  let effectiveInboxId = derivedInboxId;
  if (!effectiveInboxId) {
    console.warn('[Contacts] Generating placeholder inbox ID for legacy contact without identifiers:', contact);
    effectiveInboxId = `legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const normalizedInboxId = normalizeInboxId(effectiveInboxId);
  const addresses = normalizeContactAddresses([
    ...(contact.addresses ?? []),
    contact.primaryAddress,
    contact.address,
  ]);
  const normalizedIdentities = normalizeContactIdentities(contact.identities ?? []);

  const safeName = sanitizeDisplayLabel(contact.name);
  const safeFarcasterUsername = sanitizeDisplayLabel(contact.farcasterUsername);

  const fallbackName = (() => {
    if (safeName) return safeName;
    if (safeFarcasterUsername) return safeFarcasterUsername;
    // Never persist an Ethereum address as a "name" fallback.
    if (!isAddressLikeInboxId(normalizedInboxId)) return normalizedInboxId;
    return '';
  })();

  return {
    ...contact,
    inboxId: normalizedInboxId,
    name: fallbackName,
    avatar: contact.avatar ?? contact.preferredAvatar,
    preferredName: undefined,
    preferredAvatar: undefined,
    notes: undefined,
    addresses,
    primaryAddress: normalizeContactAddress(contact.primaryAddress) ?? addresses[0],
    identities:
      normalizedIdentities.length > 0
        ? normalizedIdentities
        : ethereumIdentitiesFromAddresses(addresses),
    farcasterUsername: contact.farcasterUsername,
    farcasterFid: contact.farcasterFid,
    farcasterScore: contact.farcasterScore,
    farcasterFollowerCount: contact.farcasterFollowerCount,
    farcasterFollowingCount: contact.farcasterFollowingCount,
    farcasterActiveStatus: contact.farcasterActiveStatus,
    farcasterPowerBadge: contact.farcasterPowerBadge,
  };
};

export const useContactStore = create<ContactState>()(
  persist(
    (set, get) => ({
      contacts: [],
      isLoading: false,

      addContact: async (rawContact) => {
        let contact = normaliseContactInput(rawContact);

        // Contacts should be keyed by XMTP inboxId, not an Ethereum address.
        if (isAddressLikeInboxId(contact.inboxId)) {
          const addressCandidate = contact.primaryAddress ?? contact.addresses?.[0] ?? contact.inboxId;
          try {
            const derived = await getXmtpClient().deriveInboxIdFromAddress(addressCandidate);
            if (derived && !isAddressLikeInboxId(derived)) {
              contact = { ...contact, inboxId: normalizeInboxId(derived) };
            } else {
              console.warn('[Contacts] Refusing to add contact without a resolved inboxId:', contact.inboxId);
              return;
            }
          } catch (error) {
            console.warn('[Contacts] Failed to resolve inboxId for address contact. Skipping add.', error);
            return;
          }
        }

        const storage = await getStorage();
        const contacts = get().contacts;
        const existingContact = contacts.find(
          (c) => normalizeInboxId(c.inboxId) === normalizeInboxId(contact.inboxId)
        );
        if (existingContact) {
          console.warn('Contact already exists:', contact.inboxId);
          return;
        }
        set((state) => ({ contacts: [...state.contacts, contact] }));
        await storage.putContact(contact);
      },

      removeContact: async (inboxId) => {
        const storage = await getStorage();
        set((state) => ({
          contacts: state.contacts.filter(
            (c) => normalizeInboxId(c.inboxId) !== normalizeInboxId(inboxId)
          ),
        }));
        await storage.deleteContact(inboxId);
      },

      updateContact: async (inboxId, updates) => {
        const storage = await getStorage();
        set((state) => {
          const merged = state.contacts.map((contact) => {
            if (normalizeInboxId(contact.inboxId) !== normalizeInboxId(inboxId)) {
              return contact;
            }
            return mergeContactData(contact, updates);
          });
          return { contacts: merged };
        });
        const contact = get().contacts.find(
          (c) => normalizeInboxId(c.inboxId) === normalizeInboxId(inboxId)
        );
        if (contact) {
          await storage.putContact(contact);
        }
      },

      blockContact: async (inboxId) => {
        let normalized = normalizeInboxId(inboxId);

        if (isAddressLikeInboxId(normalized)) {
          try {
            const derived = await getXmtpClient().deriveInboxIdFromAddress(normalized);
            if (derived && !isAddressLikeInboxId(derived)) {
              normalized = normalizeInboxId(derived);
            } else {
              console.warn('[Contacts] Unable to resolve inboxId for address during block. Skipping persist.', normalized);
              return;
            }
          } catch (error) {
            console.warn('[Contacts] Failed to resolve inboxId during block. Skipping persist.', error);
            return;
          }
        }
        const state = get();
        const existingByInbox = state.contacts.find(
          (contact) => normalizeInboxId(contact.inboxId) === normalized
        );

        if (existingByInbox) {
          await state.updateContact(normalized, { isBlocked: true });
          return;
        }

        // Ensure we persist a minimal contact record so the block survives reloads
        const placeholder: Contact = normaliseContactInput({
          inboxId: normalized,
          name: '',
          createdAt: Date.now(),
          isBlocked: true,
          isInboxOnly: true,
          source: 'inbox',
        } as Contact);

        const storage = await getStorage();
        set((prev) => ({ contacts: [...prev.contacts, placeholder] }));
        await storage.putContact(placeholder);
      },

      unblockContact: async (inboxId) => {
        const normalized = normalizeInboxId(inboxId);
        const state = get();
        const existingByInbox = state.contacts.find(
          (contact) => normalizeInboxId(contact.inboxId) === normalized
        );
        if (existingByInbox) {
          await state.updateContact(normalized, { isBlocked: false });
        }

        try {
          const storage = await getStorage();
          await storage.unmarkPeerDeletion(normalized);
        } catch (error) {
          console.warn('Failed to clear deleted conversation marker for contact:', normalized, error);
        }
      },

      loadContacts: async () => {
        set({ isLoading: true });
        try {
          const storage = await getStorage();
          const storedContacts = await storage.listContacts();
          const loadedContacts = storedContacts.map((contact) => normaliseContactInput(contact));
          await Promise.all(
            loadedContacts.map(async (contact, index) => {
              if (JSON.stringify(contact) !== JSON.stringify(storedContacts[index])) {
                await storage.putContact(contact);
              }
            })
          );
          set({ contacts: loadedContacts });
        } catch (error) {
          console.error('Failed to load contacts:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      isContact: (inboxId) => {
        const normalized = normalizeInboxId(inboxId);
        return get().contacts.some((c) => normalizeInboxId(c.inboxId) === normalized);
      },

      getContactByInboxId: (inboxId) => {
        const normalized = normalizeInboxId(inboxId);
        return get().contacts.find((c) => normalizeInboxId(c.inboxId) === normalized);
      },

      getContactByAddress: (address) => {
        const normalized = normalizeAddress(address);
        return get().contacts.find((c) =>
          c.addresses?.some((entry) => normalizeAddress(entry) === normalized)
        );
      },

      upsertContactProfile: async (profile) => {
        const storage = await getStorage();
        let normalizedInboxId = normalizeInboxId(profile.inboxId);

        const computedAddresses = normalizeContactAddresses([
          ...(profile.addresses ?? []),
          profile.primaryAddress,
          profile.metadata?.primaryAddress,
        ]);
        const addressSet = new Set(computedAddresses);

        const existing =
          get().contacts.find(
            (contact) => normalizeInboxId(contact.inboxId) === normalizedInboxId
          ) ??
          get().contacts.find((contact) => {
            if (normalizeInboxId(contact.inboxId) === normalizedInboxId) {
              return true;
            }
            const contactAddresses = normalizeContactAddresses([
              contact.primaryAddress,
              ...(contact.addresses ?? []),
            ]);
            return contactAddresses.some((address) => addressSet.has(address));
          });

        // If the caller supplied an Ethereum address as "inboxId", prefer an existing contact's
        // real inboxId, or attempt to resolve via XMTP. Never persist contacts keyed by 0x… values.
        if (existing?.inboxId && !isAddressLikeInboxId(existing.inboxId)) {
          normalizedInboxId = normalizeInboxId(existing.inboxId);
        } else if (isAddressLikeInboxId(normalizedInboxId)) {
          try {
            const addressCandidate = computedAddresses[0] ?? profile.primaryAddress ?? normalizedInboxId;
            const derived = await getXmtpClient().deriveInboxIdFromAddress(addressCandidate);
            if (derived && !isAddressLikeInboxId(derived)) {
              normalizedInboxId = normalizeInboxId(derived);
            } else {
              console.warn('[Contacts] Refusing to persist contact with address-like inboxId:', profile.inboxId);
              return normaliseContactInput({
                inboxId: profile.inboxId,
                name: sanitizeDisplayLabel(profile.displayName) ?? '',
                avatar: profile.avatarUrl,
                description: profile.metadata?.description,
                source: profile.source ?? profile.metadata?.source ?? 'inbox',
                createdAt: profile.metadata?.createdAt ?? Date.now(),
                isBlocked: profile.metadata?.isBlocked ?? false,
                isInboxOnly: true,
                primaryAddress: profile.primaryAddress ?? computedAddresses[0],
                addresses: computedAddresses,
                identities:
                  profile.identities && profile.identities.length > 0
                    ? profile.identities
                    : ethereumIdentitiesFromAddresses(computedAddresses),
                lastSyncedAt: Date.now(),
              } as Contact);
            }
          } catch (error) {
            console.warn('[Contacts] Failed to resolve inboxId for address-like profile. Skipping persist.', error);
            return normaliseContactInput({
              inboxId: profile.inboxId,
              name: sanitizeDisplayLabel(profile.displayName) ?? '',
              avatar: profile.avatarUrl,
              description: profile.metadata?.description,
              source: profile.source ?? profile.metadata?.source ?? 'inbox',
              createdAt: profile.metadata?.createdAt ?? Date.now(),
              isBlocked: profile.metadata?.isBlocked ?? false,
              isInboxOnly: true,
              primaryAddress: profile.primaryAddress ?? computedAddresses[0],
              addresses: computedAddresses,
              identities:
                profile.identities && profile.identities.length > 0
                  ? profile.identities
                  : ethereumIdentitiesFromAddresses(computedAddresses),
              lastSyncedAt: Date.now(),
            } as Contact);
          }
        }

        const normalizedProfileIdentities = normalizeContactIdentities(profile.identities ?? []);
        const identities: ContactIdentity[] =
          normalizedProfileIdentities.length > 0
            ? normalizedProfileIdentities
            : ethereumIdentitiesFromAddresses(computedAddresses);

        const isPublishedProfile = profile.source !== 'farcaster';
        const safeDisplayName = isPublishedProfile
          ? sanitizeDisplayLabel(profile.displayName)
          : undefined;
        const publishedAvatar = isPublishedProfile ? profile.avatarUrl : undefined;
        const baseContact: Contact = existing
          ? mergeContactData(existing, {
            name: safeDisplayName ?? existing.name,
            avatar: publishedAvatar ?? existing.avatar,
            primaryAddress: profile.primaryAddress ?? existing.primaryAddress,
            source: profile.source ?? existing.source,
            addresses: computedAddresses.length > 0 ? computedAddresses : existing.addresses,
            identities,
            lastSyncedAt: Date.now(),
            farcasterUsername: profile.metadata?.farcasterUsername ?? existing.farcasterUsername,
            farcasterFid: profile.metadata?.farcasterFid ?? existing.farcasterFid,
            farcasterScore: profile.metadata?.farcasterScore ?? existing.farcasterScore,
            farcasterFollowerCount:
              profile.metadata?.farcasterFollowerCount ?? existing.farcasterFollowerCount,
            farcasterFollowingCount:
              profile.metadata?.farcasterFollowingCount ?? existing.farcasterFollowingCount,
            farcasterActiveStatus:
              profile.metadata?.farcasterActiveStatus ?? existing.farcasterActiveStatus,
            farcasterPowerBadge: profile.metadata?.farcasterPowerBadge ?? existing.farcasterPowerBadge,
          })
          : normaliseContactInput({
            inboxId: normalizedInboxId,
            name:
              safeDisplayName ??
              (isAddressLikeInboxId(normalizedInboxId) ? '' : normalizedInboxId),
            avatar: publishedAvatar,
            description: profile.metadata?.description,
            source: profile.source ?? profile.metadata?.source ?? 'inbox',
            createdAt: profile.metadata?.createdAt ?? Date.now(),
            isBlocked: profile.metadata?.isBlocked ?? false,
            isInboxOnly: profile.metadata?.isInboxOnly ?? false,
            primaryAddress: profile.primaryAddress ?? computedAddresses[0],
            farcasterUsername: profile.metadata?.farcasterUsername,
            farcasterFid: profile.metadata?.farcasterFid,
            farcasterScore: profile.metadata?.farcasterScore,
            farcasterFollowerCount: profile.metadata?.farcasterFollowerCount,
            farcasterFollowingCount: profile.metadata?.farcasterFollowingCount,
            farcasterActiveStatus: profile.metadata?.farcasterActiveStatus,
            farcasterPowerBadge: profile.metadata?.farcasterPowerBadge,
            addresses: computedAddresses,
            identities,
            lastSyncedAt: Date.now(),
          } as Contact);

        const existingNormalizedInboxId = existing ? normalizeInboxId(existing.inboxId) : null;
        const finalContact: Contact =
          existing && existingNormalizedInboxId && existingNormalizedInboxId !== normalizedInboxId
            ? { ...baseContact, inboxId: normalizedInboxId }
            : baseContact;

        // Published profile discovery is not a contact-creation action. Callers
        // may use this transient value in conversation/profile UI, but only an
        // explicit addContact/blockContact action may create durable contact data.
        if (!existing && !profile.persistIfMissing) {
          return finalContact;
        }

        set((state) => {
          const withoutLegacyId =
            existing && existingNormalizedInboxId && existingNormalizedInboxId !== normalizedInboxId
              ? state.contacts.filter(
                (contact) => normalizeInboxId(contact.inboxId) !== existingNormalizedInboxId
              )
              : state.contacts;

          const replacementIndex = withoutLegacyId.findIndex(
            (contact) => normalizeInboxId(contact.inboxId) === normalizedInboxId
          );

          if (replacementIndex >= 0) {
            const updated = [...withoutLegacyId];
            updated[replacementIndex] = finalContact;
            return { contacts: updated };
          }

          return { contacts: [...withoutLegacyId, finalContact] };
        });

        if (existing && existingNormalizedInboxId && existingNormalizedInboxId !== normalizedInboxId) {
          try {
            await storage.deleteContact(existing.inboxId);
          } catch (error) {
            console.warn('Failed to delete legacy contact record during inboxId migration:', error);
          }
        }

        await storage.putContact(finalContact);
        return finalContact;
      },

    }),
    {
      name: 'converge-contacts-storage', // unique name
      storage: createJSONStorage(() => localStorage), // Use localStorage for persistence
      // We will hydrate contacts from IndexedDB on loadContacts, so we don't need to persist the full list here
      // Just using persist for the initial setup, actual data will come from IndexedDB
      partialize: (_state) => ({}), // Don't store contacts in localStorage, only use for rehydration trigger
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('Failed to rehydrate contact store:', error);
          } else {
            // get().loadContacts(); // Temporarily commented out to fix type error
          }
        };
      },
    }
  )
);
