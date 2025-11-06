import { useState, useEffect } from 'react';
import { useContactStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import type { Contact } from '@/lib/stores/contact-store';
import { QRCodeOverlay } from './QRCodeOverlay';
import { useConversations } from '@/features/conversations/useConversations';
import { useNavigate } from 'react-router-dom';

interface ContactCardModalProps {
  contact: Contact;
  onClose: () => void;
}

interface InboxState {
  inboxId: string;
  accountAddresses: string[]; // Extracted from identifiers
}

export function ContactCardModal({ contact, onClose }: ContactCardModalProps) {
  const updateContact = useContactStore((state) => state.updateContact);
  const upsertContactProfile = useContactStore((state) => state.upsertContactProfile);
  const addContact = useContactStore((s) => s.addContact);
  const removeContact = useContactStore((s) => s.removeContact);
  const isContact = useContactStore((s) => s.isContact);
  const [showQR, setShowQR] = useState(false);
  const [preferredName, setPreferredName] = useState(contact.preferredName || '');
  const [avatarUrlState, setAvatarUrlState] = useState<string | undefined>(
    contact.preferredAvatar || contact.avatar
  );
  const [notes, setNotes] = useState(contact.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [inboxState, setInboxState] = useState<InboxState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { createConversation } = useConversations();
  const navigate = useNavigate();

  useEffect(() => {
    setPreferredName(contact.preferredName || '');
    setNotes(contact.notes || '');
    setAvatarUrlState(contact.preferredAvatar || contact.avatar);
    // Load existing inbox state if available
    if (contact.inboxId) {
      loadInboxState(contact.inboxId);
    }
  }, [contact]);

  const loadInboxState = async (inboxId: string) => {
    try {
      type SafeInboxStateLite = {
        inboxId: string;
        identifiers?: Array<{ identifierKind: string; identifier: string }>;
      };
      const { getXmtpUtils } = await import('@/lib/xmtp/utils-singleton');
      const utils = await getXmtpUtils();
      const states = (await utils.inboxStateFromInboxIds([inboxId], 'production')) as unknown as SafeInboxStateLite[];
      const state = states[0];
      if (state) {
        // Extract Ethereum addresses from identifiers
        const accountAddresses = (state.identifiers || [])
          .filter((id) => id.identifierKind.toLowerCase() === 'ethereum')
          .map((id) => {
            const identifier = id.identifier;
            return identifier.startsWith('0x') ? identifier : `0x${identifier}`;
          });
        setInboxState({
          inboxId: state.inboxId,
          accountAddresses,
        });
      }
    } catch (error) {
      console.error('Failed to load inbox state:', error);
    }
  };

  const handleToggleContact = async () => {
    const inContacts = isContact(contact.inboxId);
    if (inContacts) {
      if (confirm('Remove this contact?')) {
        await removeContact(contact.inboxId);
        alert('Removed from contacts');
      }
    } else {
      await addContact({
        ...contact,
        createdAt: contact.createdAt || Date.now(),
        isInboxOnly: true,
        source: contact.source ?? 'inbox',
      } as Contact);
      alert('Added to contacts');
    }
  };

  const handleRefreshInbox = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const xmtp = getXmtpClient();
      // Always try to fetch XMTP profile first to refresh display name + avatar
      try {
        const targetInbox = contact.inboxId || contact.primaryAddress || contact.addresses?.[0];
        if (targetInbox) {
          console.log('[ContactCardModal] Refreshing profile for', targetInbox);
          const profile = await xmtp.fetchInboxProfile(String(targetInbox));
          console.log('[ContactCardModal] fetchInboxProfile result:', profile);
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
          // Reflect updates immediately in this modal
          if (profile.displayName) setPreferredName(profile.displayName);
          if (profile.avatarUrl) setAvatarUrlState(profile.avatarUrl);
        }
      } catch (e) {
        // Profile fetch failures are non-fatal for refresh
        console.warn('[ContactCardModal] Profile refresh skipped/failed:', e);
      }
      
      // Get inbox ID from address
      let inboxId = contact.inboxId;
      if (!inboxId) {
        if (!xmtp.isConnected()) {
          setRefreshError('XMTP client not connected. Please connect first.');
          setIsRefreshing(false);
          return;
        }
        const lookupAddress = contact.primaryAddress ?? contact.addresses?.[0];
        if (!lookupAddress) {
          setRefreshError('No primary address available to resolve inbox ID.');
          setIsRefreshing(false);
          return;
        }
        const resolvedInboxId = await xmtp.getInboxIdFromAddress(lookupAddress);
        if (!resolvedInboxId) {
          setRefreshError('No inbox ID found for this address. They may not be registered on XMTP.');
          setIsRefreshing(false);
          return;
        }
        inboxId = resolvedInboxId;
        // Update contact with inbox ID and ensure profile stored against new key
        await upsertContactProfile({
          inboxId,
          primaryAddress: lookupAddress.toLowerCase(),
          addresses: [lookupAddress.toLowerCase()],
          source: contact.source ?? 'inbox',
          metadata: contact,
        });
      }

      // Get inbox state with all linked identities using Utils
      type SafeInboxStateLite = {
        inboxId: string;
        identifiers?: Array<{ identifierKind: string; identifier: string }>;
      };
      const { getXmtpUtils } = await import('@/lib/xmtp/utils-singleton');
      const utils = await getXmtpUtils();
      const states = (await utils.inboxStateFromInboxIds([inboxId], 'production')) as unknown as SafeInboxStateLite[];
      const state = states[0];
      
      if (state) {
        // Extract Ethereum addresses from identifiers
        const accountAddresses = (state.identifiers || [])
          .filter((id) => id.identifierKind.toLowerCase() === 'ethereum')
          .map((id) => {
            const identifier = id.identifier;
            return identifier.startsWith('0x') ? identifier : `0x${identifier}`;
          });
        const newInboxState = {
          inboxId: state.inboxId,
          accountAddresses,
        };
        setInboxState(newInboxState);

        await upsertContactProfile({
          inboxId,
          primaryAddress: newInboxState.accountAddresses[0]?.toLowerCase(),
          addresses: newInboxState.accountAddresses.map((addr) => addr.toLowerCase()),
          source: contact.source ?? 'inbox',
          metadata: contact,
        });
      } else {
        setRefreshError('Failed to load inbox state');
      }
    } catch (error) {
      console.error('Failed to refresh inbox:', error);
      setRefreshError(error instanceof Error ? error.message : 'Failed to refresh inbox');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const targetInboxId = contact.inboxId ?? contact.primaryAddress ?? contact.addresses?.[0];
      if (!targetInboxId) {
        throw new Error('Unable to resolve inbox ID for contact update');
      }
      await updateContact(targetInboxId, { preferredName, notes });
      onClose();
    } catch (error) {
      console.error('Failed to save contact details:', error);
      alert('Failed to save contact details. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  };

  const handleMessage = async () => {
    try {
      const conv = await createConversation(contact.inboxId);
      if (conv) {
        navigate(`/chat/${conv.id}`);
        onClose();
      }
    } catch (error) {
      console.error('Failed to open conversation:', error);
    }
  };

  // Determine display name with priority
  const displayName = preferredName || contact.name;
  
  // Determine avatar (custom > Farcaster)
  const avatarUrl = avatarUrlState;

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-primary-900 rounded-lg shadow-xl w-full max-w-md p-6 relative text-primary-50 my-8">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-primary-800 transition-colors"
        >
          <svg className="w-6 h-6 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-2xl font-bold mb-6 text-center">Contact Details</h2>

        <div className="flex flex-col items-center mb-6">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full bg-primary-700 flex items-center justify-center text-4xl font-bold text-primary-50 mb-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Contact Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>

          {/* Display Name */}
          <h3 className="text-xl font-semibold mb-2">{displayName}</h3>
          {contact.preferredName && contact.preferredName !== contact.name && (
            <p className="text-primary-300 text-sm mb-4">Also known as: {contact.name}</p>
          )}

          {/* Farcaster Profile Link */}
          {contact.farcasterUsername && (
            <a
              href={`https://farcaster.xyz/${contact.farcasterUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-accent-400 hover:text-accent-300 mb-4 text-sm underline"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View on Farcaster
            </a>
          )}

          {/* Display Name Input */}
          <div className="w-full mb-4">
            <label htmlFor="preferredName" className="block text-sm font-medium text-primary-300 mb-1">
              Display Name
            </label>
            <input
              id="preferredName"
              type="text"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              className="input-primary w-full"
              placeholder="Enter display name"
            />
          </div>

          {/* Inbox ID Section */}
          <div className="w-full mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-primary-300">Inbox ID</label>
              <button
                onClick={handleRefreshInbox}
                disabled={isRefreshing}
                className="text-xs px-2 py-1 rounded bg-accent-900/50 text-accent-300 hover:bg-accent-800/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {isRefreshing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Refreshing...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </>
                )}
              </button>
            </div>
            {refreshError && (
              <p className="text-red-400 text-xs mb-2">{refreshError}</p>
            )}
            <div className="flex items-center bg-primary-800 rounded-lg p-2">
              <span className="flex-1 text-primary-50 text-sm truncate font-mono">
                {inboxState?.inboxId || contact.inboxId || contact.primaryAddress || 'Unknown'}
              </span>
              <button
                onClick={() =>
                  handleCopy(
                    inboxState?.inboxId || contact.inboxId || contact.primaryAddress || '',
                    'Inbox ID'
                  )
                }
                className="ml-2 p-1 rounded-md hover:bg-primary-700 transition-colors"
                title="Copy Inbox ID"
              >
                <svg className="w-5 h-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Known Connected Identities */}
          <div className="w-full mb-6">
            <h3 className="text-lg font-semibold text-primary-50 mb-2">Known Connected Identities</h3>
            {inboxState && inboxState.accountAddresses.length > 0 ? (
              <div className="space-y-2">
                {inboxState.accountAddresses.map((address, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-primary-800 rounded-lg p-2"
                  >
                    <span className="flex-1 text-primary-50 text-sm truncate font-mono">{address}</span>
                    <button
                      onClick={() => handleCopy(address, 'Address')}
                      className="ml-2 p-1 rounded-md hover:bg-primary-700 transition-colors"
                      title="Copy Address"
                    >
                      <svg className="w-4 h-4 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-primary-300 text-sm">
                {isRefreshing ? 'Loading identities...' : 'Click Refresh to load connected identities'}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="w-full mb-6">
            <label htmlFor="notes" className="block text-sm font-medium text-primary-300 mb-1">
              Notes (max 500 chars)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={4}
              className="input-primary w-full resize-none"
              placeholder="Add notes about this contact..."
            />
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleSave}
              className="btn-primary w-full"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => setShowQR(true)}
              className="btn-secondary w-full"
            >
              Show QR Code
            </button>
            <button
              onClick={handleToggleContact}
              className="btn-secondary w-full"
            >
              {isContact(contact.inboxId) ? 'Remove from Contacts' : 'Add to Contacts'}
            </button>
            <button
              onClick={handleMessage}
              className="btn-secondary w-full"
            >
              Message
            </button>
          </div>
        </div>
      </div>
    </div>
    {showQR && (
      <QRCodeOverlay address={contact.inboxId} onClose={() => setShowQR(false)} />
    )}
  </>
  );
}
