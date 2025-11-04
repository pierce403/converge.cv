import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '@/lib/storage';
import { fetchFarcasterUserFollowingFromAPI, resolveXmtpAddressFromFarcasterUser } from '@/lib/farcaster/service';

export interface Contact {
  address: string;
  name: string;
  avatar?: string;
  description?: string;
  isBlocked?: boolean;
  createdAt: number;
  preferredName?: string; // New field
  notes?: string; // New field
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
  syncFarcasterContacts: (fid: number) => Promise<void>; // New action
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

      syncFarcasterContacts: async (fid: number) => {
        set({ isLoading: true });
        try {
          const storage = await getStorage();
          const followedUsers = await fetchFarcasterUserFollowingFromAPI(fid);
          const newContacts: Contact[] = [];

          for (const user of followedUsers) {
            const xmtpAddress = resolveXmtpAddressFromFarcasterUser(user);
            if (xmtpAddress) {
              const existingContact = get().contacts.find(c => c.address.toLowerCase() === xmtpAddress.toLowerCase());
              const contact: Contact = {
                address: xmtpAddress,
                name: user.display_name || user.username,
                preferredName: user.display_name,
                avatar: user.pfp_url,
                createdAt: Date.now(),
              };

              if (existingContact) {
                // Update existing contact
                await storage.updateContact(xmtpAddress, contact);
                set((state) => ({
                  contacts: state.contacts.map(c =>
                    c.address.toLowerCase() === xmtpAddress.toLowerCase() ? { ...c, ...contact } : c
                  ),
                }));
              } else {
                // Add new contact
                await storage.putContact(contact);
                newContacts.push(contact);
              }
            }
          }

          if (newContacts.length > 0) {
            set((state) => ({ contacts: [...state.contacts, ...newContacts] }));
          }
          console.log(`Synced ${newContacts.length} new Farcaster contacts.`);
        } catch (error) {
          console.error('Failed to sync Farcaster contacts:', error);
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
