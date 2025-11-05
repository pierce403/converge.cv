import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContactStore } from '@/lib/stores';
import { ContactCardModal } from '@/components/ContactCardModal';
import type { Contact } from '@/lib/stores/contact-store';

export function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const isLoading = useContactStore((state) => state.isLoading);
  const [showContactCard, setShowContactCard] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const searchQuery = searchTerm.toLowerCase();
  const filteredContacts = contacts.filter((contact) => {
    if (!searchQuery) {
      return true;
    }
    const primaryAddress = contact.primaryAddress?.toLowerCase() ?? '';
    const inboxId = contact.inboxId.toLowerCase();
    const addresses = contact.addresses?.map((addr) => addr.toLowerCase()) ?? [];
    const preferred = contact.preferredName?.toLowerCase() ?? '';
    const name = contact.name?.toLowerCase() ?? '';
    return (
      name.includes(searchQuery) ||
      preferred.includes(searchQuery) ||
      inboxId.includes(searchQuery) ||
      primaryAddress.includes(searchQuery) ||
      addresses.some((addr) => addr.includes(searchQuery))
    );
  });

  return (
    <div className="flex flex-col h-full">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center justify-between backdrop-blur-md shadow-lg">
        <h2 className="text-xl font-bold text-primary-50">Contacts</h2>
        <div className="flex gap-2">
          <Link
            to="/new-group"
            className="btn-primary text-sm px-3 py-1"
          >
            + New Group
          </Link>
        </div>
      </header>

      <div className="p-4">
        <input
          type="text"
          placeholder="Search contacts..."
          className="w-full p-2 rounded-lg bg-primary-800 text-primary-50 placeholder-primary-300 focus:outline-none focus:ring-2 focus:ring-accent-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <main className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-primary-300 text-center">Loading contacts...</p>
        ) : filteredContacts.length === 0 ? (
          <p className="text-primary-300 text-center">No contacts found.</p>
        ) : (
          <ul className="space-y-2">
            {filteredContacts.map((contact) => {
              const label =
                contact.preferredName ||
                contact.name ||
                contact.primaryAddress ||
                contact.inboxId;
              const secondary =
                contact.primaryAddress ??
                contact.addresses?.[0] ??
                contact.inboxId;

              return (
              <li
                key={contact.inboxId}
                className="bg-primary-900/70 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:bg-primary-800/50 transition-colors"
                onClick={() => {
                  setSelectedContact(contact);
                  setShowContactCard(true);
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-primary-50 font-medium">
                      {label}
                    </p>
                    {contact.source === 'farcaster' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent-900/50 text-accent-300 border border-accent-800/50">
                        FC
                      </span>
                    )}
                    {contact.isInboxOnly && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary-800/50 text-primary-400 border border-primary-700/50">
                        Inbox
                      </span>
                    )}
                  </div>
                  <p className="text-primary-300 text-sm">{secondary}</p>
                </div>
              </li>
            );
          })}
          </ul>
        )}
      </main>

      {selectedContact && showContactCard && (
        <ContactCardModal
          contact={selectedContact}
          onClose={() => setShowContactCard(false)}
        />
      )}
    </div>
  );
}
