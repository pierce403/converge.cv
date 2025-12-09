import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import {
  fetchFarcasterUserFollowingFromAPI,
  resolveXmtpAddressFromFarcasterUser,
  resolveContactName,
} from '@/lib/farcaster/service';
import { fetchFarcasterFollowingWithNeynar, fetchNeynarUserProfile } from '@/lib/farcaster/neynar';
import { useFarcasterStore } from './farcaster-store';

const normalizeInboxId = (inboxId: string): string => inboxId.toLowerCase();

const normalizeAddress = (address: string): string =>
  address.startsWith('0x') ? address.toLowerCase() : address.toLowerCase();

const dedupe = (values: (string | undefined | null)[]): string[] => {
  const set = new Set<string>();
  for (const value of values) {
    if (value) {
      set.add(value);
    }
  }
  return Array.from(set);
};

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
  syncFarcasterContacts: (
    fid: number,
    onProgress?: (
      current: number,
      total: number,
      status?: string,
      details?: FarcasterSyncProgressDetail
    ) => void
  ) => Promise<void>;
}

export type FarcasterSyncAction = 'fetch' | 'process' | 'check' | 'skip' | 'save' | 'update' | 'complete' | 'error';

export interface FarcasterSyncProgressDetail {
  userName?: string;
  address?: string;
  fid?: number;
  action?: FarcasterSyncAction;
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
}

const mergeContactData = (existing: Contact, updates: ContactUpdates): Contact => {
  const addresses = dedupe([
    ...(updates.addresses ?? []),
    ...(existing.addresses ?? []),
    existing.primaryAddress,
    updates.primaryAddress,
  ]);

  const identities = (() => {
    const merged = [...(existing.identities ?? [])];
    const incoming = updates.identities ?? [];
    for (const identity of incoming) {
      const idx = merged.findIndex(
        (entry) =>
          entry.identifier.toLowerCase() === identity.identifier.toLowerCase() &&
          entry.kind === identity.kind
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
    name: updates.name ?? existing.name,
    avatar: updates.avatar ?? existing.avatar,
    preferredName: updates.preferredName ?? existing.preferredName,
    preferredAvatar: updates.preferredAvatar ?? existing.preferredAvatar,
    addresses,
    identities,
    primaryAddress: updates.primaryAddress ?? existing.primaryAddress ?? addresses[0],
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
  const addresses = dedupe([
    ...(contact.addresses ?? []),
    contact.primaryAddress,
    contact.address,
  ])
    .filter(Boolean)
    .map((value) => normalizeAddress(value as string));

  return {
    ...contact,
    inboxId: normalizedInboxId,
    name: contact.name || contact.preferredName || normalizedInboxId,
    addresses,
    primaryAddress: contact.primaryAddress ?? addresses[0],
    identities:
      contact.identities && contact.identities.length > 0
        ? contact.identities
        : addresses.map((address, index) => ({
            identifier: address,
            kind: 'Ethereum',
            isPrimary: index === 0,
          })),
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
        const contact = normaliseContactInput(rawContact);
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
        const normalized = normalizeInboxId(inboxId);
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
          name: normalized,
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
          const loadedContacts = (await storage.listContacts()).map((contact) =>
            normaliseContactInput(contact)
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
        const normalizedInboxId = normalizeInboxId(profile.inboxId);

        const computedAddresses = dedupe([
          ...(profile.addresses ?? []),
          profile.primaryAddress,
          profile.metadata?.primaryAddress,
        ]).map(normalizeAddress);
        const addressSet = new Set(computedAddresses);

        const existing =
          get().contacts.find(
            (contact) => normalizeInboxId(contact.inboxId) === normalizedInboxId
          ) ??
          get().contacts.find((contact) => {
            if (normalizeInboxId(contact.inboxId) === normalizedInboxId) {
              return true;
            }
            const contactAddresses = dedupe([
              contact.primaryAddress,
              ...(contact.addresses ?? []),
            ])
              .filter(Boolean)
              .map((address) => normalizeAddress(address!));
            return contactAddresses.some((address) => addressSet.has(address));
          });

        const identities: ContactIdentity[] =
          profile.identities && profile.identities.length > 0
            ? profile.identities
            : computedAddresses.map((address, index) => ({
                identifier: address,
                kind: 'Ethereum',
                isPrimary: index === 0,
              }));

        const baseContact: Contact = existing
          ? mergeContactData(existing, {
              name: profile.displayName ?? existing.name,
              preferredName: profile.displayName ?? existing.preferredName,
              avatar: profile.avatarUrl ?? existing.avatar,
              preferredAvatar: profile.avatarUrl ?? existing.preferredAvatar,
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
                profile.displayName ??
                profile.metadata?.preferredName ??
                computedAddresses[0] ??
                normalizedInboxId,
              avatar: profile.avatarUrl ?? profile.metadata?.preferredAvatar,
              preferredName: profile.displayName ?? profile.metadata?.preferredName,
              preferredAvatar: profile.avatarUrl ?? profile.metadata?.preferredAvatar,
              description: profile.metadata?.description,
              notes: profile.metadata?.notes,
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

      syncFarcasterContacts: async (
        fid: number,
        onProgress?: (
          current: number,
          total: number,
          status?: string,
          details?: FarcasterSyncProgressDetail
        ) => void
      ) => {
        const report = (
          current: number,
          total: number,
          status?: string,
          details?: FarcasterSyncProgressDetail
        ) => {
          onProgress?.(current, total, status, details);
        };

        set({ isLoading: true });
        try {

          report(0, 0, 'Fetching your Farcaster following list...', { action: 'fetch' });
          const storage = await getStorage();
          const farcasterState = useFarcasterStore.getState?.();
          const neynarKey = farcasterState?.getEffectiveNeynarApiKey?.();
          const xmtp = getXmtpClient();
          const followedUsers = neynarKey
            ? await fetchFarcasterFollowingWithNeynar(fid, neynarKey)
            : await fetchFarcasterUserFollowingFromAPI(fid);
          const total = followedUsers.length;
          const shorten = (addr?: string | null) =>
            addr && addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr ?? '';

          report(0, total, `Found ${total} users you follow. Processing contacts...`, { action: 'fetch' });
          
          let current = 0;
          const newContacts: Contact[] = [];
          const updatedContacts: Contact[] = [];
          const skippedContacts: number[] = [];

          for (let i = 0; i < followedUsers.length; i++) {
            const user = followedUsers[i];
            const userName = user.display_name || user.username || `FID ${user.fid}`;

            report(current, total, `Processing ${userName} (${i + 1}/${total})...`, {
              action: 'process',
              fid: user.fid,
              userName,
            });

            const xmtpAddress = resolveXmtpAddressFromFarcasterUser(user);
            if (!xmtpAddress) {
              skippedContacts.push(user.fid);
              report(current, total, `Skipping ${userName} - no verified Ethereum address`, {
                action: 'skip',
                fid: user.fid,
                userName,
              });
              continue;
            }

            current++;
            report(current, total, `Checking ${userName} (${shorten(xmtpAddress)}) for XMTP...`, {
              action: 'check',
              fid: user.fid,
              userName,
              address: xmtpAddress,
            });

            // Resolve name with priority (ENS > .fcast.id > .base.eth > Farcaster)
            const nameResolution = await resolveContactName(user, xmtpAddress);

            const neynarProfile = neynarKey ? await fetchNeynarUserProfile(user.fid || user.username, neynarKey) : null;
            const farcasterScore =
              neynarProfile?.score ?? (user as { score?: number }).score ?? undefined;
            const farcasterFollowerCount =
              neynarProfile?.follower_count ?? (user as { follower_count?: number }).follower_count;
            const farcasterFollowingCount =
              neynarProfile?.following_count ?? (user as { following_count?: number }).following_count;
            const farcasterActiveStatus =
              neynarProfile?.active_status ?? (user as { active_status?: string }).active_status;
            const farcasterPowerBadge =
              neynarProfile?.power_badge ?? (user as { power_badge?: boolean }).power_badge;

            const existingContact = get().contacts.find(
              (contact) =>
                contact.addresses?.some((addr) => normalizeAddress(addr) === normalizeAddress(xmtpAddress))
            );
            
            report(
              current,
              total,
              existingContact
                ? `Updating existing contact: ${nameResolution.preferredName || nameResolution.name}...`
                : `Adding new contact: ${nameResolution.preferredName || nameResolution.name}...`,
              {
                action: existingContact ? 'update' : 'save',
                fid: user.fid,
                userName: nameResolution.preferredName || nameResolution.name || userName,
                address: xmtpAddress,
              }
            );
            
            const inboxId =
              existingContact?.inboxId ??
              (await getXmtpClient().deriveInboxIdFromAddress?.(xmtpAddress)) ??
              xmtpAddress;

            const canReceive = xmtp?.canMessage ? await xmtp.canMessage(inboxId) : true;
            if (!canReceive) {
              skippedContacts.push(user.fid);
              report(current, total, `Skipping ${userName} - no XMTP inbox for ${shorten(inboxId)}`, {
                action: 'skip',
                fid: user.fid,
                userName,
                address: inboxId,
              });
              continue;
            }

            const contact: Contact = normaliseContactInput({
              inboxId,
              name: nameResolution.preferredName || nameResolution.name || inboxId,
              preferredName: nameResolution.preferredName,
              avatar: existingContact?.avatar || user.pfp_url,
              createdAt: existingContact?.createdAt || Date.now(),
              source: 'farcaster',
              farcasterUsername: user.username,
              farcasterFid: user.fid,
              farcasterScore,
              farcasterFollowerCount,
              farcasterFollowingCount,
              farcasterActiveStatus,
              farcasterPowerBadge,
              isInboxOnly: false,
              addresses: dedupe([xmtpAddress, existingContact?.primaryAddress, ...(existingContact?.addresses ?? [])]),
              primaryAddress: existingContact?.primaryAddress ?? xmtpAddress,
              identities: existingContact?.identities ?? [],
              preferredAvatar: existingContact?.preferredAvatar,
              notes: existingContact?.notes,
            } as Contact);

            if (existingContact) {
              // Update existing contact (merge with Farcaster data)
              await storage.putContact(contact);
              set((state) => ({
                contacts: state.contacts.map((c) =>
                  normalizeInboxId(c.inboxId) === normalizeInboxId(contact.inboxId) ? contact : c
                ),
              }));
              updatedContacts.push(contact);
            } else {
              // Add new contact
              await storage.putContact(contact);
              newContacts.push(contact);
            }
            
            report(current, total, `Saved: ${nameResolution.preferredName || nameResolution.name}`, {
              action: existingContact ? 'update' : 'save',
              fid: user.fid,
              userName: nameResolution.preferredName || nameResolution.name,
              address: inboxId,
            });
          }

          if (newContacts.length > 0) {
            set((state) => ({ contacts: [...state.contacts, ...newContacts] }));
          }
          
          const summary = `Sync complete! ${newContacts.length} new, ${updatedContacts.length} updated, ${skippedContacts.length} skipped`;
          console.log(`Synced ${newContacts.length} new Farcaster contacts.`);
          report(total, total, summary, { action: 'complete' });
        } catch (error) {
          console.error('Failed to sync Farcaster contacts:', error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          report(0, 0, `Error: ${errorMsg}`, { action: 'error' });
        } finally {
          set({ isLoading: false });
        }
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
