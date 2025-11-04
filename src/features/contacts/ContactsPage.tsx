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
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, status: '' });
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [userFid, setUserFid] = useState<number | null>(null);
  const [isResolvingFid, setIsResolvingFid] = useState(false);
  const [showFidInput, setShowFidInput] = useState(false);
  const [manualFid, setManualFid] = useState<string>('');
  const [fidResolutionError, setFidResolutionError] = useState<{
    type: 'no_ens' | 'no_farcaster' | 'api_error';
    message: string;
    ensName?: string;
  } | null>(null);
  const [farcasterProfile, setFarcasterProfile] = useState<{
    username: string;
    displayName: string;
    fid: number;
    pfpUrl?: string;
  } | null>(null);

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
      setFidResolutionError(null);
      try {
        // First check for ENS name
        const { resolveENSFromAddress } = await import('@/lib/utils/ens');
        const ensName = await resolveENSFromAddress(identity.address);
        
        if (!ensName) {
          // No ENS name found
          setFidResolutionError({
            type: 'no_ens',
            message: 'No ENS name found for your address. Please set up an ENS name (e.g., yourname.eth) to enable automatic Farcaster sync.',
          });
          setIsResolvingFid(false);
          return;
        }
        
        // Try to resolve FID using the ENS name
        const fid = await resolveFidFromAddress(identity.address);
        if (fid) {
          setUserFid(fid);
          setFidResolutionError(null);
          
          // Fetch profile to show preview
          try {
            const { fetchFarcasterUserFromAPI } = await import('@/lib/farcaster/service');
            const profile = await fetchFarcasterUserFromAPI(fid);
            if (profile) {
              setFarcasterProfile({
                username: profile.username,
                displayName: profile.display_name || profile.username,
                fid: profile.fid,
                pfpUrl: profile.pfp_url,
              });
            }
          } catch (error) {
            console.error('Failed to fetch Farcaster profile:', error);
          }
          
          // Store FID in identity
          const storage = await getStorage();
          const updatedIdentity = { ...identity, farcasterFid: fid };
          await storage.putIdentity(updatedIdentity);
          // Update auth store
          setIdentity(updatedIdentity);
        } else {
          // Try to fetch profile by ENS username to show what could be synced
          try {
            const { fetchFarcasterUserFromAPI } = await import('@/lib/farcaster/service');
            const ensUsername = ensName.replace(/\.eth$/, '');
            const profile = await fetchFarcasterUserFromAPI(ensUsername);
            if (profile) {
              setFarcasterProfile({
                username: profile.username,
                displayName: profile.display_name || profile.username,
                fid: profile.fid,
                pfpUrl: profile.pfp_url,
              });
              // Found profile! Use the FID
              setUserFid(profile.fid);
              const storage = await getStorage();
              const updatedIdentity = { ...identity, farcasterFid: profile.fid };
              await storage.putIdentity(updatedIdentity);
              setIdentity(updatedIdentity);
              setFidResolutionError(null);
            } else {
              // ENS exists but no Farcaster user found
              setFidResolutionError({
                type: 'no_farcaster',
                message: `No Farcaster account found for ${ensName}. Make sure your Farcaster account is linked to this ENS name.`,
                ensName,
              });
            }
          } catch (error) {
            // ENS exists but no Farcaster user found
            setFidResolutionError({
              type: 'no_farcaster',
              message: `No Farcaster account found for ${ensName}. Make sure your Farcaster account is linked to this ENS name.`,
              ensName,
            });
          }
        }
      } catch (error) {
        console.error('Failed to resolve Farcaster FID:', error);
        setFidResolutionError({
          type: 'api_error',
          message: `Failed to check Farcaster account: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
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
          <div className="flex flex-col gap-2">
            <button
              onClick={async () => {
                // If no FID, show helpful message or manual input
                if (!userFid) {
                  if (fidResolutionError?.type === 'no_ens') {
                    alert('Please set up an ENS name for your address to enable automatic Farcaster sync. Visit ens.domains to register your name.');
                    return;
                  }
                  if (fidResolutionError?.type === 'no_farcaster') {
                    // Show manual input with helpful context
                    setShowFidInput(true);
                    return;
                  }
                  // Still resolving or other error - show manual input
                  setShowFidInput(true);
                  return;
                }

                setShowSyncModal(true);
                setSyncProgress({ current: 0, total: 0, status: 'Starting sync...' });
                setSyncLog(['Starting Farcaster contact sync...']);
                
                try {
                  await syncFarcasterContacts(userFid, (current, total, status) => {
                    setSyncProgress({ current, total, status: status || '' });
                    if (status) {
                      setSyncLog((prev) => [...prev, status]);
                    }
                  });
                } catch (error) {
                  console.error('Failed to sync Farcaster contacts:', error);
                  alert('Failed to sync Farcaster contacts. Please try again.');
                  setShowSyncModal(false);
                }
              }}
              className="btn-secondary text-sm px-3 py-1"
              disabled={isLoading || isResolvingFid}
              title={isResolvingFid ? 'Resolving Farcaster FID...' : userFid ? 'Sync your Farcaster contacts' : fidResolutionError?.type === 'no_ens' ? 'ENS name required' : 'Enter Farcaster FID to sync contacts'}
            >
              {isResolvingFid ? 'Resolving...' : 'Sync Farcaster'}
            </button>
            {farcasterProfile && (
              <div className="flex items-center gap-2 p-2 bg-primary-800/30 rounded border border-primary-700/50 max-w-xs">
                {farcasterProfile.pfpUrl && (
                  <img 
                    src={farcasterProfile.pfpUrl} 
                    alt={farcasterProfile.displayName}
                    className="w-6 h-6 rounded-full"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-primary-200 truncate">
                    {farcasterProfile.displayName}
                  </p>
                  <p className="text-xs text-primary-400 truncate">
                    @{farcasterProfile.username}
                  </p>
                </div>
              </div>
            )}
            {fidResolutionError && (
              <p className="text-xs text-primary-400 max-w-xs text-right">
                {fidResolutionError.type === 'no_ens' && '💡 Get an ENS name at ens.domains'}
                {fidResolutionError.type === 'no_farcaster' && `💡 Link ${fidResolutionError.ensName} to your Farcaster account`}
                {fidResolutionError.type === 'api_error' && '⚠️ Lookup failed, try manual entry'}
              </p>
            )}
          </div>
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
              status={syncProgress.status}
              log={syncLog}
              accountName={farcasterProfile?.displayName || farcasterProfile?.username}
              accountFid={userFid || farcasterProfile?.fid}
              onClose={() => {
                setShowSyncModal(false);
                setSyncLog([]);
              }}
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
            {fidResolutionError?.type === 'no_farcaster' && fidResolutionError.ensName ? (
              <div className="mb-4 p-3 bg-primary-800/50 rounded-lg border border-primary-700/50">
                <p className="text-primary-200 text-sm mb-2">
                  We found your ENS name: <strong className="text-accent-400">{fidResolutionError.ensName}</strong>
                </p>
                <p className="text-primary-300 text-xs mb-2">
                  However, no Farcaster account was found linked to this ENS name.
                </p>
                <p className="text-primary-300 text-xs">
                  You can either:
                </p>
                <ul className="text-primary-300 text-xs list-disc list-inside mt-2 space-y-1">
                  <li>Link your Farcaster account to {fidResolutionError.ensName} on farcaster.xyz</li>
                  <li>Enter your Farcaster FID manually below</li>
                </ul>
              </div>
            ) : (
              <p className="text-primary-300 mb-4 text-sm">
                Your Farcaster FID is a number. You can find it on your Farcaster profile or by visiting farcaster.xyz
              </p>
            )}

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
                    
                    // Fetch profile to get account name
                    try {
                      const { fetchFarcasterUserFromAPI } = await import('@/lib/farcaster/service');
                      const profile = await fetchFarcasterUserFromAPI(fid);
                      if (profile) {
                        setFarcasterProfile({
                          username: profile.username,
                          displayName: profile.display_name || profile.username,
                          fid: profile.fid,
                          pfpUrl: profile.pfp_url,
                        });
                      }
                    } catch (error) {
                      console.error('Failed to fetch Farcaster profile:', error);
                    }
                    
                    setShowFidInput(false);
                    setManualFid('');
                    // Trigger sync
                    setShowSyncModal(true);
                    setSyncProgress({ current: 0, total: 0, status: 'Starting sync...' });
                    setSyncLog(['Starting Farcaster contact sync...']);
                    syncFarcasterContacts(fid, (current, total, status) => {
                      setSyncProgress({ current, total, status: status || '' });
                      if (status) {
                        setSyncLog((prev) => [...prev, status]);
                      }
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
                  
                  // Fetch profile to get account name
                  try {
                    const { fetchFarcasterUserFromAPI } = await import('@/lib/farcaster/service');
                    const profile = await fetchFarcasterUserFromAPI(fid);
                    if (profile) {
                      setFarcasterProfile({
                        username: profile.username,
                        displayName: profile.display_name || profile.username,
                        fid: profile.fid,
                        pfpUrl: profile.pfp_url,
                      });
                    }
                  } catch (error) {
                    console.error('Failed to fetch Farcaster profile:', error);
                  }
                  
                  setShowFidInput(false);
                  setManualFid('');
                  // Trigger sync
                  setShowSyncModal(true);
                  setSyncProgress({ current: 0, total: 0, status: 'Starting sync...' });
                  setSyncLog(['Starting Farcaster contact sync...']);
                  try {
                    await syncFarcasterContacts(fid, (current, total, status) => {
                      setSyncProgress({ current, total, status: status || '' });
                      if (status) {
                        setSyncLog((prev) => [...prev, status]);
                      }
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
