import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '@/lib/storage';
import { 
  fetchFarcasterUserFollowingFromAPI, 
  resolveXmtpAddressFromFarcasterUser,
  resolveContactName 
} from '@/lib/farcaster/service';

export interface Contact {
  address: string;
  name: string;
  avatar?: string;
  description?: string;
  isBlocked?: boolean;
  createdAt: number;
  preferredName?: string;
  notes?: string;
  source?: 'farcaster' | 'inbox' | 'manual'; // Origin of contact
  farcasterUsername?: string; // Farcaster username for profile link
  farcasterFid?: number; // Farcaster FID
  inboxId?: string; // XMTP inbox ID
  isInboxOnly?: boolean; // True if contact only exists from incoming messages
}

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  addContact: (contact: Contact) => Promise<void>;
  removeContact: (address: string) => Promise<void>;
  updateContact: (address: string, updates: Partial<Contact>) => Promise<void>;
  loadContacts: () => Promise<void>;
  isContact: (address: string) => boolean;
  getContactByAddress: (address: string) => Contact | undefined;
  syncFarcasterContacts: (fid: number, onProgress?: (current: number, total: number, status?: string) => void) => Promise<void>;
}

export const useContactStore = create<ContactState>()(
  persist(
    (set, get) => ({
      contacts: [],
      isLoading: false,

      addContact: async (contact) => {
        const storage = await getStorage();
        const existingContact = get().contacts.find(c => c.address.toLowerCase() === contact.address.toLowerCase());
        if (existingContact) {
          console.warn('Contact already exists:', contact.address);
          return;
        }
        set((state) => ({ contacts: [...state.contacts, contact] }));
        await storage.putContact(contact);
      },

      removeContact: async (address) => {
        const storage = await getStorage();
        set((state) => ({ contacts: state.contacts.filter(c => c.address.toLowerCase() !== address.toLowerCase()) }));
        await storage.deleteContact(address);
      },

      updateContact: async (address, updates) => {
        const storage = await getStorage();
        set((state) => ({
          contacts: state.contacts.map(c =>
            c.address.toLowerCase() === address.toLowerCase() ? { ...c, ...updates } : c
          ),
        }));
        await storage.updateContact(address, updates);
      },

      loadContacts: async () => {
        set({ isLoading: true });
        try {
          const storage = await getStorage();
          const loadedContacts = await storage.listContacts();
          set({ contacts: loadedContacts });
        } catch (error) {
          console.error('Failed to load contacts:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      isContact: (address) => {
        return get().contacts.some(c => c.address.toLowerCase() === address.toLowerCase());
      },

      getContactByAddress: (address) => {
        return get().contacts.find(c => c.address.toLowerCase() === address.toLowerCase());
      },

      syncFarcasterContacts: async (fid: number, onProgress?: (current: number, total: number, status?: string) => void) => {
        set({ isLoading: true });
        try {
          onProgress?.(0, 0, 'Fetching your Farcaster following list...');
          const storage = await getStorage();
          const followedUsers = await fetchFarcasterUserFollowingFromAPI(fid);
          const total = followedUsers.length;
          
          onProgress?.(0, total, `Found ${total} users you follow. Processing contacts...`);
          
          let current = 0;
          const newContacts: Contact[] = [];
          const updatedContacts: Contact[] = [];
          const skippedContacts: number[] = [];

          for (let i = 0; i < followedUsers.length; i++) {
            const user = followedUsers[i];
            const userName = user.display_name || user.username || `FID ${user.fid}`;
            
            onProgress?.(current, total, `Processing ${userName} (${i + 1}/${total})...`);
            
            const xmtpAddress = resolveXmtpAddressFromFarcasterUser(user);
            if (!xmtpAddress) {
              skippedContacts.push(user.fid);
              onProgress?.(current, total, `Skipping ${userName} - no verified Ethereum address`);
              continue;
            }

            current++;
            onProgress?.(current, total, `Resolving names for ${userName}...`);

            // Resolve name with priority (ENS > .fcast.id > .base.eth > Farcaster)
            const nameResolution = await resolveContactName(user, xmtpAddress);
            
            const existingContact = get().contacts.find(c => c.address.toLowerCase() === xmtpAddress.toLowerCase());
            
            onProgress?.(current, total, existingContact 
              ? `Updating existing contact: ${nameResolution.preferredName || nameResolution.name}...`
              : `Adding new contact: ${nameResolution.preferredName || nameResolution.name}...`);
            
            const contact: Contact = {
              address: xmtpAddress,
              name: nameResolution.name,
              preferredName: nameResolution.preferredName,
              // Only use Farcaster avatar if no existing avatar
              avatar: existingContact?.avatar || user.pfp_url,
              createdAt: existingContact?.createdAt || Date.now(),
              source: 'farcaster', // Upgrade from inbox-only to farcaster
              farcasterUsername: user.username,
              farcasterFid: user.fid,
              // Keep existing inbox ID if present
              inboxId: existingContact?.inboxId,
              isInboxOnly: false, // No longer inbox-only after merge
            };

            if (existingContact) {
              // Update existing contact (merge with Farcaster data)
              await storage.updateContact(xmtpAddress, contact);
              set((state) => ({
                contacts: state.contacts.map(c =>
                  c.address.toLowerCase() === xmtpAddress.toLowerCase() ? { ...c, ...contact } : c
                ),
              }));
              updatedContacts.push(contact);
            } else {
              // Add new contact
              await storage.putContact(contact);
              newContacts.push(contact);
            }
            
            onProgress?.(current, total, `Saved: ${nameResolution.preferredName || nameResolution.name}`);
          }

          if (newContacts.length > 0) {
            set((state) => ({ contacts: [...state.contacts, ...newContacts] }));
          }
          
          const summary = `Sync complete! ${newContacts.length} new, ${updatedContacts.length} updated, ${skippedContacts.length} skipped`;
          console.log(`Synced ${newContacts.length} new Farcaster contacts.`);
          onProgress?.(total, total, summary);
        } catch (error) {
          console.error('Failed to sync Farcaster contacts:', error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          onProgress?.(0, 0, `Error: ${errorMsg}`);
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
