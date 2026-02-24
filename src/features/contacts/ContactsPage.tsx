import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContactStore, useAuthStore, useFarcasterStore } from '@/lib/stores';
import { ContactCardModal } from '@/components/ContactCardModal';
import type { Contact } from '@/lib/stores/contact-store';
import { sanitizeImageSrc } from '@/lib/utils/image';
import { FarcasterSyncModal, FarcasterSyncCheck } from '@/components/FarcasterSyncModal';
import { resolveFidFromAddress, resolveFidFromIdentifier } from '@/lib/farcaster/service';

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
  const syncFarcasterContacts = useContactStore((state) => state.syncFarcasterContacts);
  const [showContactCard, setShowContactCard] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const identity = useAuthStore((state) => state.identity);
  const [showFarcasterForm, setShowFarcasterForm] = useState(false);
  const [fidInput, setFidInput] = useState(() => (identity?.farcasterFid ? String(identity.farcasterFid) : ''));
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncCurrent, setSyncCurrent] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string | undefined>();
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncChecks, setSyncChecks] = useState<FarcasterSyncCheck[]>([]);
  const hasNeynarKey = useFarcasterStore((state) => state.hasNeynarApiKey());
  const getNeynarKey = useFarcasterStore((state) => state.getEffectiveNeynarApiKey);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const isEphemeralIdentity = Boolean(identity?.mnemonic || identity?.privateKey);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const resolveFarcasterFid = async (): Promise<number> => {
    setResolveError(null);
    const trimmed = fidInput.trim();
    const apiKey = getNeynarKey();
    const addressCandidates: string[] = [];

    if (trimmed && /^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      addressCandidates.push(trimmed);
    } else if (!trimmed && identity?.address) {
      addressCandidates.push(identity.address);
    }

    for (const address of addressCandidates) {
      const fid = await resolveFidFromAddress(address, apiKey);
      if (fid) {
        if (!trimmed) {
          setFidInput(String(fid));
        }
        return fid;
      }
    }

    if (!trimmed) {
      const message =
        identity?.address && !isEphemeralIdentity
          ? 'No Farcaster account is connected to your primary address.'
          : 'Enter a Farcaster FID or username to sync contacts.';
      setResolveError(message);
      throw new Error(message);
    }

    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    const fid = await resolveFidFromIdentifier(trimmed, apiKey);
    if (fid) {
      return fid;
    }

    const message =
      addressCandidates.length > 0
        ? 'Unable to resolve a Farcaster account from that Ethereum address.'
        : 'Unable to resolve that Farcaster account.';
    setResolveError(message);
    throw new Error(message);
  };

  const handleFarcasterSync = async () => {
    if (!hasNeynarKey) {
      alert('Add a Neynar API key in Settings to enable Farcaster sync.');
      return;
    }

    try {
      setIsSyncing(true);
      setSyncLog([]);
      setSyncChecks([]);
      const fid = await resolveFarcasterFid();
      setShowSyncModal(true);
      await syncFarcasterContacts(fid, (current, total, status, details) => {
        setSyncCurrent(current);
        setSyncTotal(total);
        if (status) {
          setSyncStatus(status);
          setSyncLog((prev) => [...prev, status]);
        }

        if (details?.address || details?.userName) {
          setSyncChecks((prev) => [
            ...prev,
            {
              statusText: status ?? details.action ?? 'Processing',
              address: details.address,
              userName: details.userName,
              fid: details.fid,
              action: details.action,
              at: Date.now(),
            },
          ]);
        }
      });

      if (identity && identity.farcasterFid !== fid) {
        try {
          const updatedIdentity = { ...identity, farcasterFid: fid };
          const storage = await (await import('@/lib/storage')).getStorage();
          await storage.putIdentity(updatedIdentity);
          useAuthStore.getState().setIdentity(updatedIdentity);
        } catch (error) {
          console.warn('Failed to persist Farcaster FID on identity', error);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync Farcaster contacts';
      setSyncStatus(message);
      alert(message);
      setShowSyncModal(false);
    } finally {
      setIsSyncing(false);
    }
  };

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
          {hasNeynarKey && (
            <div className="flex items-center gap-2">
              {showFarcasterForm ? (
                <>
                  <input
                    type="text"
                    value={fidInput}
                    onChange={(e) => setFidInput(e.target.value)}
                    className="input-primary w-40 text-sm"
                    placeholder="Your FID or username"
                    aria-label="Farcaster FID or username"
                    disabled={isSyncing}
                  />
                  <button
                    onClick={handleFarcasterSync}
                    className="btn-secondary text-sm px-3 py-1"
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Syncing…' : 'Sync Farcaster'}
                  </button>
                  <button
                    onClick={() => setShowFarcasterForm(false)}
                    className="btn-secondary text-sm px-3 py-1"
                    disabled={isSyncing}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowFarcasterForm(true)}
                  className="btn-secondary text-sm px-3 py-1"
                  title="Sync the Farcaster accounts you follow into contacts"
                >
                  Sync Farcaster
                </button>
              )}
            </div>
          )}
          {resolveError && identity?.address && !isEphemeralIdentity && (
            <div className="text-xs text-primary-300 bg-primary-900/60 border border-primary-800 rounded px-3 py-2">
              <p className="mb-2">
                We couldn’t find a Farcaster account for your primary address {identity.address.slice(0, 6)}…
                {identity.address.slice(-4)}. External wallets are preferred for Farcaster account security.
              </p>
              <a
                href="https://warpcast.com/~/signup"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs px-3 py-1 inline-block"
              >
                Sign up for Farcaster with your wallet
              </a>
            </div>
          )}
          <button
            onClick={async () => {
              // Refresh all contacts' display name + avatar from XMTP
              try {
                const xmtp = (await import('@/lib/xmtp')).getXmtpClient();
                for (const c of contacts) {
                  try {
                    let inboxId = c.inboxId;
                    if (!inboxId || inboxId.startsWith('0x')) {
                      const addressCandidate = c.primaryAddress || c.addresses?.[0];
                      if (addressCandidate) {
                        try {
                          const resolved =
                            (await xmtp.getInboxIdFromAddress(addressCandidate)) ||
                            (await xmtp.deriveInboxIdFromAddress(addressCandidate));
                          if (resolved && !resolved.startsWith('0x')) {
                            inboxId = resolved.toLowerCase();
                          }
                        } catch (resolveErr) {
                          console.warn('[Contacts] Failed to resolve inbox id during refresh', resolveErr);
                        }
                      }
                    }

                    if (!inboxId || inboxId.startsWith('0x')) {
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
                      metadata: c,
                    });
                  } catch (e) {
                    console.warn('[Contacts] Refresh failed for', c.inboxId || c.primaryAddress || c.addresses?.[0], e);
                  }
                }
                alert('Contacts refreshed.');
              } catch (e) {
                console.error('Failed to refresh contacts:', e);
                alert('Failed to refresh contacts');
              }
            }}
            className="btn-secondary text-sm px-3 py-1"
            title="Refresh avatars and display names"
          >
            Refresh
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
            {filteredContacts.map((contact) => {
              const label =
                contact.preferredName ||
                contact.name ||
                formatIdentifier(contact.inboxId);
              const secondary =
                contact.primaryAddress ??
                contact.addresses?.[0] ??
                contact.inboxId;

              // Avatar precedence: preferredAvatar > avatar; show initials if none/invalid
              const avatarSrc = contact.preferredAvatar || contact.avatar;
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
                  className="bg-primary-900/70 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:bg-primary-800/50 transition-colors"
                  onClick={() => {
                    setSelectedContact(contact);
                    setShowContactCard(true);
                  }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
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
                      <p className="text-primary-50 font-medium truncate">
                        {label}
                      </p>
                      {contact.source === 'farcaster' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent-900/50 text-accent-300 border border-accent-800/50 flex-shrink-0">
                          FC
                        </span>
                      )}
                      {contact.farcasterScore !== undefined &&
                        contact.farcasterScore !== null &&
                        Number.isFinite(contact.farcasterScore) && (
                          <span className="text-xs px-1 py-0.5 rounded bg-accent-950/50 text-accent-200 border border-accent-900/60 flex-shrink-0">
                            Score {contact.farcasterScore.toFixed(2)}
                          </span>
                        )}
                      {contact.isInboxOnly && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary-800/50 text-primary-400 border border-primary-700/50 flex-shrink-0">
                          Inbox
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this contact?')) {
                        removeContact(contact.inboxId);
                      }
                    }}
                    className="ml-3 text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-800/50 border border-red-800/60"
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
      {showSyncModal && (
        <FarcasterSyncModal
          isOpen={showSyncModal}
          current={syncCurrent}
          total={syncTotal}
          status={syncStatus}
          log={syncLog}
          checks={syncChecks}
          accountName={fidInput}
          accountFid={Number(fidInput) || undefined}
          onClose={() => setShowSyncModal(false)}
        />
      )}
    </div>
  );
}
