/**
 * New chat page for starting conversations
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversations } from './useConversations';
// import { getXmtpClient } from '@/lib/xmtp';
import { resolveAddressOrENS, isENSName, isEthereumAddress } from '@/lib/utils/ens';

export function NewChatPage() {
  const navigate = useNavigate();
  const { createConversation } = useConversations();

  const [inputValue, setInputValue] = useState('');
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  // We no longer pre-check registration with canMessage to avoid false negatives.
  // The SDK will validate during DM creation.
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!inputValue.trim()) {
      setError('Please enter an address or ENS name');
      return;
    }

    try {
      // Step 1: Resolve ENS name if needed
      let targetAddress = inputValue.trim();
      
      if (isENSName(inputValue)) {
        setIsResolving(true);
        console.log('[NewChat] Resolving ENS name:', inputValue);
        
        const resolved = await resolveAddressOrENS(inputValue);
        setIsResolving(false);
        
        if (!resolved) {
          setError(`Could not resolve ENS name: ${inputValue}`);
          return;
        }
        
        targetAddress = resolved;
        setResolvedAddress(resolved);
        console.log('[NewChat] ✅ Resolved to:', resolved);
      } else if (!isEthereumAddress(inputValue)) {
        setError('Invalid Ethereum address or ENS name format');
        return;
      }

      // Step 2: Create conversation (SDK validates registration)
      setIsCreating(true);

      const conversation = await createConversation(targetAddress);

      if (conversation) {
        navigate(`/chat/${conversation.id}`);
      } else {
        setError('Failed to create conversation');
        setIsCreating(false);
      }
    } catch (err) {
      console.error('Error creating conversation:', err);
      setError('Failed to create conversation. Please try again.');
      setIsResolving(false);
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full text-primary-50">
      {/* Header */}
      <div className="bg-primary-950/70 border-b border-primary-800/60 px-4 py-3 flex items-center gap-3 backdrop-blur-md">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">New Chat</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 bg-primary-950/30">
        <div className="max-w-md mx-auto">
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 text-primary-50">Start a conversation</h2>
            <p className="text-sm text-primary-200">
              Enter an Ethereum address or ENS name to start chatting via XMTP
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="address" className="block text-sm font-medium mb-2">
                Ethereum Address or ENS Name
              </label>
              <input
                id="address"
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setResolvedAddress(null);
                  setError('');
                }}
                placeholder="0x... or example.eth"
                className="input-primary"
                autoFocus
                disabled={isResolving || isCreating}
              />
              {resolvedAddress && (
                <p className="text-xs text-accent-300 mt-1">
                  ✓ Resolved to: {resolvedAddress.slice(0, 10)}...{resolvedAddress.slice(-8)}
                </p>
              )}
              <p className="text-xs text-primary-300 mt-1">
                Must be a valid Ethereum address or ENS name registered on XMTP
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
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={isResolving || isCreating}
              >
                {isResolving ? 'Resolving ENS...' : isCreating ? 'Creating...' : 'Start Chat'}
              </button>
            </div>
          </form>

          {/* Recent/suggested contacts would go here */}
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-primary-300 mb-3">Recent Contacts</h3>
            <p className="text-sm text-primary-300/80 text-center py-4">No recent contacts</p>
          </div>
        </div>
      </div>
    </div>
  );
}
