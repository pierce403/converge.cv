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
  const [isResolvingFid, setIsResolvingFid] = useState(false);
  const [showFidInput, setShowFidInput] = useState(false);
  const [manualFid, setManualFid] = useState<string>('');

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
      setIsResolvingFid(true);
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
          // Don't set error - allow manual entry
          console.log('No Farcaster FID found for address, allowing manual entry');
        }
      } catch (error) {
        console.error('Failed to resolve Farcaster FID:', error);
        // Don't set error - allow manual entry
      } finally {
        setIsResolvingFid(false);
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
              // If no FID, show input dialog
              if (!userFid) {
                setShowFidInput(true);
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
            disabled={isLoading || isResolvingFid}
            title={isResolvingFid ? 'Resolving Farcaster FID...' : userFid ? 'Sync your Farcaster contacts' : 'Enter Farcaster FID to sync contacts'}
          >
            {isResolvingFid ? 'Resolving...' : 'Sync Farcaster'}
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

      {/* Manual FID Input Modal */}
      {showFidInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-primary-900 rounded-lg shadow-xl w-full max-w-md p-6 relative text-primary-50">
            <button
              onClick={() => {
                setShowFidInput(false);
                setManualFid('');
              }}
              className="absolute top-3 right-3 p-2 rounded-full hover:bg-primary-800 transition-colors"
            >
              <svg className="w-6 h-6 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-2xl font-bold mb-4">Enter Farcaster FID</h2>
            <p className="text-primary-300 mb-4 text-sm">
              Your Farcaster FID is a number. You can find it on your Farcaster profile or by visiting farcaster.xyz
            </p>

            <input
              type="number"
              value={manualFid}
              onChange={(e) => setManualFid(e.target.value)}
              placeholder="Enter your FID (e.g., 194)"
              className="input-primary w-full mb-4"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && manualFid) {
                  const fid = parseInt(manualFid, 10);
                  if (!isNaN(fid) && fid > 0) {
                    setUserFid(fid);
                    // Store in identity
                    if (identity) {
                      const storage = await getStorage();
                      const updatedIdentity = { ...identity, farcasterFid: fid };
                      await storage.putIdentity(updatedIdentity);
                      setIdentity(updatedIdentity);
                    }
                    setShowFidInput(false);
                    setManualFid('');
                    // Trigger sync
                    setShowSyncModal(true);
                    setSyncProgress({ current: 0, total: 0 });
                    syncFarcasterContacts(fid, (current, total) => {
                      setSyncProgress({ current, total });
                    }).catch((error) => {
                      console.error('Failed to sync Farcaster contacts:', error);
                      alert('Failed to sync Farcaster contacts. Please try again.');
                      setShowSyncModal(false);
                    });
                  }
                }
              }}
            />

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowFidInput(false);
                  setManualFid('');
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const fid = parseInt(manualFid, 10);
                  if (isNaN(fid) || fid <= 0) {
                    alert('Please enter a valid FID number');
                    return;
                  }

                  setUserFid(fid);
                  // Store in identity
                  if (identity) {
                    const storage = await getStorage();
                    const updatedIdentity = { ...identity, farcasterFid: fid };
                    await storage.putIdentity(updatedIdentity);
                    setIdentity(updatedIdentity);
                  }
                  setShowFidInput(false);
                  setManualFid('');
                  // Trigger sync
                  setShowSyncModal(true);
                  setSyncProgress({ current: 0, total: 0 });
                  try {
                    await syncFarcasterContacts(fid, (current, total) => {
                      setSyncProgress({ current, total });
                    });
                  } catch (error) {
                    console.error('Failed to sync Farcaster contacts:', error);
                    alert('Failed to sync Farcaster contacts. Please try again.');
                    setShowSyncModal(false);
                  }
                }}
                className="btn-primary flex-1"
                disabled={!manualFid}
              >
                Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
