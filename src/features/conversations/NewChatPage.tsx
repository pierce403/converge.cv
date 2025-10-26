/**
 * New chat page for starting conversations
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversations } from './useConversations';
import { getXmtpClient } from '@/lib/xmtp';

export function NewChatPage() {
  const navigate = useNavigate();
  const { createConversation } = useConversations();

  const [address, setAddress] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!address.trim()) {
      setError('Please enter an address');
      return;
    }

    // Basic Ethereum address validation
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError('Invalid Ethereum address format');
      return;
    }

    try {
      setIsChecking(true);

      // Check if address can receive XMTP messages
      const xmtp = getXmtpClient();
      const canMessage = await xmtp.canMessage(address);

      if (!canMessage) {
        setError('This address is not registered on XMTP');
        setIsChecking(false);
        return;
      }

      setIsChecking(false);
      setIsCreating(true);

      // Create conversation
      const conversation = await createConversation(address);

      if (conversation) {
        navigate(`/chat/${conversation.id}`);
      } else {
        setError('Failed to create conversation');
        setIsCreating(false);
      }
    } catch (err) {
      console.error('Error creating conversation:', err);
      setError('Failed to create conversation. Please try again.');
      setIsChecking(false);
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">New Chat</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-md mx-auto">
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2">Start a conversation</h2>
            <p className="text-sm text-slate-400">
              Enter an Ethereum address to start chatting via XMTP
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="address" className="block text-sm font-medium mb-2">
                Ethereum Address
              </label>
              <input
                id="address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className="input-primary"
                autoFocus
                disabled={isChecking || isCreating}
              />
              <p className="text-xs text-slate-500 mt-1">
                Must be a valid Ethereum address registered on XMTP
              </p>
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="btn-secondary flex-1"
                disabled={isChecking || isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={isChecking || isCreating}
              >
                {isChecking ? 'Checking...' : isCreating ? 'Creating...' : 'Start Chat'}
              </button>
            </div>
          </form>

          {/* Recent/suggested contacts would go here */}
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-slate-400 mb-3">Recent Contacts</h3>
            <p className="text-sm text-slate-500 text-center py-4">No recent contacts</p>
          </div>
        </div>
      </div>
    </div>
  );
}

