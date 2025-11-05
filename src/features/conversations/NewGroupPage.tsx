import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContactStore } from '@/lib/stores';
import { useConversations } from './useConversations';
import { getAddress } from 'viem';

export function NewGroupPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContactAddresses, setSelectedContactAddresses] = useState<string[]>([]);
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const isLoading = useContactStore((state) => state.isLoading);
  const { createGroupConversation } = useConversations();

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const filteredContacts = contacts.filter((contact) => {
    const query = searchTerm.toLowerCase();
    if (!query) {
      return true;
    }
    const primaryAddress = contact.primaryAddress?.toLowerCase() ?? '';
    const inboxId = contact.inboxId.toLowerCase();
    const addresses = contact.addresses?.map((addr) => addr.toLowerCase()) ?? [];
    const preferred = contact.preferredName?.toLowerCase() ?? '';
    const name = contact.name?.toLowerCase() ?? '';
    return (
      name.includes(query) ||
      preferred.includes(query) ||
      inboxId.includes(query) ||
      primaryAddress.includes(query) ||
      addresses.some((addr) => addr.includes(query))
    );
  });

  const handleSelectContact = (address: string) => {
    setSelectedContactAddresses(prev =>
      prev.includes(address) ? prev.filter(addr => addr !== address) : [...prev, address]
    );
  };

  const handleCreateGroup = async () => {
    if (selectedContactAddresses.length === 0) return;

    try {
      const newGroupConversation = await createGroupConversation(selectedContactAddresses);

      if (newGroupConversation) {
        navigate(`/chat/${newGroupConversation.id}`); // Navigate to the new group chat
      } else {
        alert('Failed to create group chat. Please try again.');
      }
    } catch (error) {
      console.error('Failed to create group chat:', error);
      alert('Failed to create group chat. Please try again.');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center justify-between backdrop-blur-md shadow-lg">
        <button onClick={() => navigate(-1)} className="text-primary-300 hover:text-primary-100">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl font-bold text-primary-50">New Group</h2>
        <button
          onClick={handleCreateGroup}
          className="btn-primary text-sm px-3 py-1"
          disabled={selectedContactAddresses.length === 0}
        >
          Create ({selectedContactAddresses.length})
        </button>
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
              const primaryAddress = contact.primaryAddress ?? contact.addresses?.[0];
              const isSelectable = Boolean(primaryAddress);
              const label =
                contact.preferredName ||
                contact.name ||
                primaryAddress ||
                contact.inboxId;

              if (!isSelectable) {
                return null;
              }

              let canonicalAddress = primaryAddress!;
              if (primaryAddress!.startsWith('0x') || primaryAddress!.startsWith('0X')) {
                try {
                  canonicalAddress = getAddress(primaryAddress! as `0x${string}`);
                } catch {
                  canonicalAddress = primaryAddress!.toLowerCase();
                }
              }

              return (
              <li
                key={contact.inboxId}
                className={`bg-primary-900/70 p-3 rounded-lg flex items-center justify-between cursor-pointer ${
                  selectedContactAddresses.includes(canonicalAddress) ? 'ring-2 ring-accent-500' : ''
                }`}
                onClick={() => handleSelectContact(canonicalAddress)}
              >
                <div>
                  <p className="text-primary-50 font-medium">{label}</p>
                  <p className="text-primary-300 text-sm">{primaryAddress}</p>
                </div>
                {selectedContactAddresses.includes(canonicalAddress) && (
                  <svg className="w-6 h-6 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </li>
            );
          })}
          </ul>
        )}
      </main>
    </div>
  );
}
