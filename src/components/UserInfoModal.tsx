import { useMemo, useState, useEffect } from 'react';
import { QRCodeOverlay } from './QRCodeOverlay';
import { getContactInfo } from '@/lib/default-contacts';
import { useContactStore } from '@/lib/stores';
import { AddContactButton } from '@/features/contacts/AddContactButton';
import type { ContactIdentity } from '@/lib/stores/contact-store';
import { getXmtpClient } from '@/lib/xmtp';
import { sanitizeImageSrc } from '@/lib/utils/image';

interface UserInfoModalProps {
  inboxId: string;
  onClose: () => void;
}

export function UserInfoModal({ inboxId, onClose }: UserInfoModalProps) {
  const [showQR, setShowQR] = useState(false);
  const contact = useContactStore((state) => state.getContactByInboxId(inboxId) ?? state.getContactByAddress(inboxId));
  const contactInfo = getContactInfo(contact?.primaryAddress ?? contact?.addresses?.[0] ?? inboxId);

  const truncate = (addr: string) => {
    return addr.length > 12 ? `${addr.slice(0, 10)}...${addr.slice(-8)}` : addr;
  };

  const displayName = contact?.preferredName || contact?.name || contactInfo?.name || truncate(inboxId);
  const avatar = contact?.preferredAvatar || contact?.avatar || contactInfo?.avatar;
  const identities = useMemo(() => contact?.identities ?? [], [contact?.identities]);

  const isContactFn = useContactStore((s) => s.isContact);
  const isAlreadyContact = isContactFn(inboxId);

  const upsertContactProfile = useContactStore((s) => s.upsertContactProfile);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const xmtp = getXmtpClient();
        const profile = await xmtp.fetchInboxProfile(inboxId);
        if (!mounted) return;
        await upsertContactProfile({
          inboxId: profile.inboxId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          primaryAddress: profile.primaryAddress,
          addresses: profile.addresses,
          identities: profile.identities,
          source: 'inbox',
        });
      } catch (e) {
        // Non-fatal if profile fetch fails
        console.warn('[UserInfoModal] Profile fetch failed', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [inboxId, upsertContactProfile]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
        <div 
          className="relative bg-primary-950 rounded-xl border border-primary-800/60 p-6 shadow-xl max-w-sm w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 text-primary-300 hover:text-primary-100 transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* User info */}
          <div className="space-y-4">
            {/* Avatar and name */}
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-primary-700/80 flex items-center justify-center text-3xl mb-3 overflow-hidden">
                {avatar ? (
                  (() => {
                    const safeAvatar = sanitizeImageSrc(avatar);
                    if (safeAvatar) {
                      return <img src={safeAvatar} alt="Contact avatar" className="w-full h-full object-cover" />;
                    }
                    return <span>{avatar}</span>;
                  })()
                ) : (
                  <span className="text-white font-semibold">
                    {inboxId.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              
              <h3 className="text-lg font-semibold text-primary-100">{displayName}</h3>
              <p className="text-sm text-primary-300 mt-1">Inbox ID: {truncate(inboxId)}</p>
            </div>

            {/* Description */}
            {contactInfo?.description && (
              <div className="text-sm text-primary-200 text-center pb-3 border-b border-primary-800/60">
                {contactInfo.description}
              </div>
            )}

            {/* Address */}
            <div className="space-y-3">
              <div>
                <div className="text-xs text-primary-300 mb-1">Inbox ID</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-primary-900/50 px-3 py-2 rounded border border-primary-800/60 text-primary-100 truncate">
                    {inboxId}
                  </code>
                  <button
                    onClick={() => copyToClipboard(inboxId)}
                    className="p-2 text-primary-200 hover:text-primary-100 hover:bg-primary-900/50 rounded transition-colors"
                    title="Copy inbox ID"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>

              {identities.length > 0 && (
                <div>
                  <div className="text-xs text-primary-300 mb-1">Linked identities</div>
                  <div className="space-y-1">
                    {identities.map((identity: ContactIdentity, index: number) => (
                      <div key={`${identity.kind}-${identity.identifier}-${index}`} className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-primary-900/40 px-3 py-2 rounded border border-primary-800/50 text-primary-100 truncate">
                          {identity.kind}: {truncate(identity.identifier)}
                        </code>
                        <button
                          onClick={() => copyToClipboard(identity.identifier)}
                          className="p-2 text-primary-200 hover:text-primary-100 hover:bg-primary-900/50 rounded transition-colors"
                          title="Copy identifier"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-2 space-y-2">
              {!isAlreadyContact && (
                <AddContactButton
                  inboxId={inboxId}
                  primaryAddress={contact?.primaryAddress}
                  fallbackName={displayName}
                />
              )}
              <button
                onClick={() => setShowQR(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-900/40 hover:bg-primary-800/60 border border-primary-800/60 hover:border-primary-700 rounded-lg transition-colors text-primary-200 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                Show QR Code
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* QR Code Overlay */}
      {showQR && (
        <QRCodeOverlay address={inboxId} onClose={() => setShowQR(false)} />
      )}
    </>
  );
}
