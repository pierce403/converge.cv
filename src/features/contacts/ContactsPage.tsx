import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContactStore } from '@/lib/stores';

export function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const { contacts, loadContacts, isLoading } = useContactStore();

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center justify-between backdrop-blur-md shadow-lg">
        <h2 className="text-xl font-bold text-primary-50">Contacts</h2>
        <Link
          to="/new-group"
          className="btn-primary text-sm px-3 py-1"
        >
          + New Group
        </Link>
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
              <li key={contact.address} className="bg-primary-900/70 p-3 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-primary-50 font-medium">{contact.name}</p>
                  <p className="text-primary-300 text-sm">{contact.address}</p>
                </div>
                {/* Add as Contact button will go here for 1:1 conversations */}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
