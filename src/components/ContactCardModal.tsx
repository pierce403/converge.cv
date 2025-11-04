import { useState, useEffect } from 'react';
import { useContactStore } from '@/lib/stores';
import type { Contact } from '@/lib/stores/contact-store';

interface ContactCardModalProps {
  contact: Contact;
  onClose: () => void;
}

export function ContactCardModal({ contact, onClose }: ContactCardModalProps) {
  const { updateContact } = useContactStore();
  const [preferredName, setPreferredName] = useState(contact.preferredName || '');
  const [notes, setNotes] = useState(contact.notes || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setPreferredName(contact.preferredName || '');
    setNotes(contact.notes || '');
  }, [contact]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateContact(contact.address, { preferredName, notes });
      onClose();
    } catch (error) {
      console.error('Failed to save contact details:', error);
      alert('Failed to save contact details. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyInboxId = () => {
    if (contact.address) {
      navigator.clipboard.writeText(contact.address);
      alert('Address copied to clipboard!');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-primary-900 rounded-lg shadow-xl w-full max-w-md p-6 relative text-primary-50">
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
            {contact.avatar ? (
              <img src={contact.avatar} alt="Contact Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              contact.name.charAt(0).toUpperCase()
            )}
          </div>

          {/* Preferred Name */}
          <div className="w-full mb-4">
            <label htmlFor="preferredName" className="block text-sm font-medium text-primary-300 mb-1">
              Preferred Name
            </label>
            <input
              id="preferredName"
              type="text"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              className="input-primary w-full"
              placeholder="Enter preferred name"
            />
          </div>

          {/* Inbox ID */}
          <div className="w-full mb-4">
            <label className="block text-sm font-medium text-primary-300 mb-1">Inbox ID (Address)</label>
            <div className="flex items-center bg-primary-800 rounded-lg p-2">
              <span className="flex-1 text-primary-50 text-sm truncate">{contact.address}</span>
              <button
                onClick={handleCopyInboxId}
                className="ml-2 p-1 rounded-md hover:bg-primary-700 transition-colors"
                title="Copy Inbox ID"
              >
                <svg className="w-5 h-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-4 0h-4" />
                </svg>
              </button>
            </div>
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

          {/* Known Connected Identities (Placeholder) */}
          <div className="w-full mb-6">
            <h3 className="text-lg font-semibold text-primary-50 mb-2">Known Connected Identities</h3>
            <p className="text-primary-300 text-sm">[Placeholder for connected identities]</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="btn-primary w-full"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
