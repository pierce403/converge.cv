import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContactStore, useAuthStore } from '@/lib/stores';
import { ContactCardModal } from '@/components/ContactCardModal';
import { FarcasterSyncModal } from '@/components/FarcasterSyncModal';
import { resolveFidFromAddress } from '@/lib/farcaster/service';
import { getStorage } from '@/lib/storage';
import type { Contact } from '@/lib/stores/contact-store';

export function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const { contacts, loadContacts, isLoading, syncFarcasterContacts } = useContactStore();
  const { identity, setIdentity } = useAuthStore();
  const [showContactCard, setShowContactCard] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [userFid, setUserFid] = useState<number | null>(null);
  const [fidError, setFidError] = useState<string | null>(null);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Check for user's Farcaster FID
  useEffect(() => {
    const checkFarcasterFid = async () => {
      if (!identity) return;

      // First check if FID is stored in identity
      if (identity.farcasterFid) {
        setUserFid(identity.farcasterFid);
        return;
      }

      // Try to resolve FID from address
      try {
        const fid = await resolveFidFromAddress(identity.address);
        if (fid) {
          setUserFid(fid);
          // Store FID in identity
          const storage = await getStorage();
          const updatedIdentity = { ...identity, farcasterFid: fid };
          await storage.putIdentity(updatedIdentity);
          // Update auth store
          setIdentity(updatedIdentity);
        } else {
          setFidError('No Farcaster account found. Please sign up at farcaster.xyz');
        }
      } catch (error) {
        console.error('Failed to resolve Farcaster FID:', error);
        setFidError('Failed to check Farcaster account. Please try again.');
      }
    };

    checkFarcasterFid();
  }, [identity, setIdentity]);

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center justify-between backdrop-blur-md shadow-lg">
        <h2 className="text-xl font-bold text-primary-50">Contacts</h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (fidError) {
                alert(fidError);
                return;
              }
              
              if (!userFid) {
                alert('Please sign up for a Farcaster account at farcaster.xyz');
                return;
              }

              setShowSyncModal(true);
              setSyncProgress({ current: 0, total: 0 });
              
              try {
                await syncFarcasterContacts(userFid, (current, total) => {
                  setSyncProgress({ current, total });
                });
              } catch (error) {
                console.error('Failed to sync Farcaster contacts:', error);
                alert('Failed to sync Farcaster contacts. Please try again.');
                setShowSyncModal(false);
              }
            }}
            className="btn-secondary text-sm px-3 py-1"
            disabled={isLoading || !userFid}
          >
            Sync Farcaster
          </button>
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
            {filteredContacts.map(contact => (
              <li
                key={contact.address}
                className="bg-primary-900/70 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:bg-primary-800/50 transition-colors"
                onClick={() => {
                  setSelectedContact(contact);
                  setShowContactCard(true);
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-primary-50 font-medium">
                      {contact.preferredName || contact.name}
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
                  <p className="text-primary-300 text-sm">{contact.address}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selectedContact && showContactCard && (
        <ContactCardModal
          contact={selectedContact}
          onClose={() => setShowContactCard(false)}
        />
      )}

      <FarcasterSyncModal
        isOpen={showSyncModal}
        current={syncProgress.current}
        total={syncProgress.total}
        onClose={() => setShowSyncModal(false)}
      />
    </div>
  );
}
