import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContactStore } from '@/lib/stores';
import { ContactCardModal } from '@/components/ContactCardModal';
import type { Contact } from '@/lib/stores/contact-store';
import { sanitizeImageSrc } from '@/lib/utils/image';

const formatIdentifier = (value?: string | null): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('0x') && lower.length > 10) {
    return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
  }
  if (raw.length > 18) {
    return `${raw.slice(0, 10)}…${raw.slice(-4)}`;
  }
  return raw;
};

export function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const isLoading = useContactStore((state) => state.isLoading);
  const removeContact = useContactStore((state) => state.removeContact);
  const upsertContactProfile = useContactStore((state) => state.upsertContactProfile);
  const [showContactCard, setShowContactCard] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null);

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
    const name = contact.name?.toLowerCase() ?? '';
    return (
      name.includes(searchQuery) ||
      inboxId.includes(searchQuery) ||
      primaryAddress.includes(searchQuery) ||
      addresses.some((addr) => addr.includes(searchQuery))
    );
  });

  const handleRefreshContacts = async () => {
    if (isRefreshing) return;
    if (contacts.length === 0) {
      setRefreshFeedback('No contacts to refresh.');
      return;
    }

    setIsRefreshing(true);
    setRefreshFeedback(null);
    let nextIndex = 0;
    let refreshed = 0;
    let failed = 0;

    try {
      const xmtp = (await import('@/lib/xmtp')).getXmtpClient();
      const refreshNext = async () => {
        while (nextIndex < contacts.length) {
          const contact = contacts[nextIndex++];
          try {
            let inboxId = contact.inboxId;
            if (!inboxId || inboxId.startsWith('0x')) {
              const addressCandidate = contact.primaryAddress || contact.addresses?.[0];
              if (addressCandidate) {
                inboxId = await xmtp.resolveInboxIdForAddress(addressCandidate, {
                  context: 'ContactsPage:refresh',
                }) ?? '';
              }
            }

            if (!inboxId || inboxId.startsWith('0x')) {
              failed += 1;
              continue;
            }

            const profile = await xmtp.refreshInboxProfile(inboxId);
            await upsertContactProfile({
              inboxId: profile.inboxId,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              primaryAddress: profile.primaryAddress,
              addresses: profile.addresses,
              identities: profile.identities,
              source: 'inbox',
              metadata: contact,
            });
            refreshed += 1;
          } catch (error) {
            failed += 1;
            console.warn('[Contacts] A contact refresh failed', error);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, contacts.length) }, () => refreshNext()),
      );
      setRefreshFeedback(
        failed > 0
          ? `${refreshed} refreshed; ${failed} could not be refreshed.`
          : `${refreshed} contact${refreshed === 1 ? '' : 's'} refreshed.`,
      );
    } catch (error) {
      console.error('Failed to refresh contacts:', error);
      setRefreshFeedback('Contacts could not be refreshed. Try again when connected.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center justify-between backdrop-blur-md shadow-lg">
        <h2 className="text-xl font-bold text-primary-50">Contacts</h2>
        <div className="flex gap-2">
          <button
            onClick={() => void handleRefreshContacts()}
            disabled={isRefreshing}
            className="btn-secondary text-sm px-3 py-1"
            title="Refresh avatars and display names"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link
            to="/new-group"
            className="btn-primary text-sm px-3 py-1"
          >
            + New Group
          </Link>
        </div>
      </header>

      {refreshFeedback && (
        <p className="px-4 pt-3 text-sm text-primary-300" role="status">
          {refreshFeedback}
        </p>
      )}

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
                contact.name ||
                formatIdentifier(contact.inboxId);
              const secondary =
                contact.primaryAddress ??
                contact.addresses?.[0] ??
                contact.inboxId;

              const avatarSrc = contact.avatar;
              const safeAvatar = sanitizeImageSrc(avatarSrc || '');
              const wantInitials = !safeAvatar;
              const initialsBasis = label || secondary || contact.inboxId;
              const initials = (initialsBasis || '??')
                .replace(/^0x/i, '')
                .slice(0, 2)
                .toUpperCase();

              return (
                <li
                  key={contact.inboxId}
                  className="bg-primary-900/70 rounded-lg flex items-center justify-between hover:bg-primary-800/50 transition-colors"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-500"
                    onClick={() => {
                      setSelectedContact(contact);
                      setShowContactCard(true);
                    }}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary-700/80 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {wantInitials ? (
                        <span className="text-white font-semibold text-sm" aria-hidden>
                          {initials}
                        </span>
                      ) : (
                        <img
                          src={safeAvatar ?? ''}
                          alt="Contact avatar"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-primary-50 font-medium truncate">{label}</span>
                      {contact.isInboxOnly && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary-800/50 text-primary-400 border border-primary-700/50 flex-shrink-0">
                          Inbox
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this contact?')) {
                        void removeContact(contact.inboxId);
                      }
                    }}
                    className="mr-3 text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-800/50 border border-red-800/60"
                    title="Delete contact"
                  >
                    Delete
                  </button>
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
