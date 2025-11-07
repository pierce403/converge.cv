import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore, useContactStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import { ContactCardModal } from '@/components/ContactCardModal';
import type { Contact } from '@/lib/stores/contact-store';

export function ContactLinkPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isVaultUnlocked } = useAuthStore();
  const contacts = useContactStore((s) => s.contacts);
  const upsertContactProfile = useContactStore((s) => s.upsertContactProfile);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Contact | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!userId) {
        navigate('/');
        return;
      }
      if (!isAuthenticated || !isVaultUnlocked) {
        navigate(`/onboarding?connect=1&u=${encodeURIComponent(userId)}`);
        return;
      }
      try {
        const existing = contacts.find((c) => c.inboxId.toLowerCase() === userId.toLowerCase());
        if (existing) {
          setTarget(existing);
          setOpen(true);
          return;
        }
        // Try to fetch profile by treating userId as inbox identifier (ENS or inbox id)
        try {
          const xmtp = getXmtpClient();
          const profile = await xmtp.fetchInboxProfile(userId);
          const contact = await upsertContactProfile({
            inboxId: profile.inboxId || userId,
            displayName: profile.displayName || userId,
            avatarUrl: profile.avatarUrl,
            primaryAddress: profile.primaryAddress,
            addresses: profile.addresses,
            identities: profile.identities,
            source: 'inbox',
            metadata: { createdAt: Date.now(), isInboxOnly: true },
          });
          setTarget(contact);
          setOpen(true);
        } catch {
          // Fallback minimal contact
          const minimal: Contact = {
            inboxId: userId.toLowerCase(),
            name: userId,
            createdAt: Date.now(),
            source: 'inbox',
            isInboxOnly: true,
            addresses: [],
            identities: [],
          } as Contact;
          setTarget(minimal);
          setOpen(true);
        }
      } catch (e) {
        navigate('/');
      }
    };
    run();
  }, [userId, isAuthenticated, isVaultUnlocked, contacts, upsertContactProfile, navigate]);

  const handleClose = () => {
    setOpen(false);
    navigate('/contacts');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-primary-50">
      <p>Opening profile…</p>
      <p className="text-sm text-primary-300 mt-2">Please wait, you are being redirected.</p>
      {open && target && (
        <ContactCardModal contact={target} onClose={handleClose} />
      )}
    </div>
  );
}
