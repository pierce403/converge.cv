import { useState } from 'react';
import { useContactStore, Contact } from '@/lib/stores';
import { getContactInfo } from '@/lib/default-contacts';

interface AddContactButtonProps {
  address: string;
}

export function AddContactButton({ address }: AddContactButtonProps) {
  const addContact = useContactStore((state) => state.addContact);
  const isContact = useContactStore((state) => state.isContact);
  const getContactByAddress = useContactStore((state) => state.getContactByAddress);

  const contactExists = isContact(address);
  const contact = getContactByAddress(address);

  const handleAddContact = async () => {
    if (!contactExists) {
      const defaultInfo = getContactInfo(address);
      const newContact: Contact = {
        address: address,
        name: defaultInfo?.name || address,
        avatar: defaultInfo?.avatar,
        description: defaultInfo?.description,
        createdAt: Date.now(),
      };
      await addContact(newContact);
      alert(`Added ${newContact.name} to contacts!`);
    }
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
      className="p-2 text-primary-200 hover:text-white border border-primary-800/60 hover:border-primary-700 rounded-lg transition-colors bg-primary-900/40 hover:bg-primary-800/60"
      title="Add to contacts"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}

