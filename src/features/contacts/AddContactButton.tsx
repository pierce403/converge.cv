import { useContactStore, type Contact, type ContactIdentity } from '@/lib/stores';
import { getContactInfo } from '@/lib/default-contacts';
import { getXmtpClient } from '@/lib/xmtp';

interface AddContactButtonProps {
  inboxId: string;
  fallbackName?: string;
  primaryAddress?: string;
  disabled?: boolean;
}

export function AddContactButton({
  inboxId,
  fallbackName,
  primaryAddress,
  disabled,
}: AddContactButtonProps) {
  const addContact = useContactStore((state) => state.addContact);
  const isContact = useContactStore((state) => state.isContact);
  const getContactByAddress = useContactStore((state) => state.getContactByAddress);

  const normalizedInboxId = inboxId.toLowerCase();
  const contactExists =
    isContact(normalizedInboxId) ||
    Boolean(primaryAddress && getContactByAddress(primaryAddress.toLowerCase()));

  const isAddressLike = (value: string) => value.trim().toLowerCase().startsWith('0x');

  const handleAddContact = async () => {
    if (contactExists || disabled) {
      return;
    }

    let resolvedInboxId = normalizedInboxId;
    if (isAddressLike(resolvedInboxId)) {
      try {
        const addressCandidate = (primaryAddress ?? inboxId).toLowerCase();
        const derived = await getXmtpClient().deriveInboxIdFromAddress(addressCandidate);
        if (derived && !isAddressLike(derived)) {
          resolvedInboxId = derived.toLowerCase();
        } else {
          alert('Unable to resolve an XMTP inbox ID for that address yet. Try again after connecting to XMTP.');
          return;
        }
      } catch (error) {
        console.warn('[AddContactButton] Failed to resolve inboxId for address contact', error);
        alert('Unable to resolve an XMTP inbox ID for that address yet. Try again after connecting to XMTP.');
        return;
      }
    }

    if (isContact(resolvedInboxId)) {
      return;
    }

    const defaultInfo = getContactInfo(primaryAddress ?? inboxId);
    const identities: ContactIdentity[] = [];
    if (primaryAddress) {
      identities.push({
        identifier: primaryAddress.toLowerCase(),
        kind: 'Ethereum',
        isPrimary: true,
        displayLabel: defaultInfo?.name ?? fallbackName,
      });
    }

    const newContact: Contact = {
      inboxId: resolvedInboxId,
      name: fallbackName || defaultInfo?.name || resolvedInboxId,
      avatar: defaultInfo?.avatar,
      description: defaultInfo?.description,
      createdAt: Date.now(),
      primaryAddress: primaryAddress?.toLowerCase(),
      addresses: identities.map((identity) => identity.identifier),
      identities,
      source: 'inbox',
      isInboxOnly: true,
    };

    await addContact(newContact);
    alert(`Added ${newContact.name} to contacts!`);
  };

  if (contactExists) {
    return (
      <span className="p-2 text-primary-400" title="Already in contacts">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }

  return (
    <button
      onClick={handleAddContact}
      className="p-2 text-primary-200 hover:text-white border border-primary-800/60 hover:border-primary-700 rounded-lg transition-colors bg-primary-900/40 hover:bg-primary-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Add to contacts"
      disabled={disabled}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}
