/**
 * Search page for messages and conversations
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStorage } from '@/lib/storage';
import { formatMessageTime } from '@/lib/utils/date';
import type { Message } from '@/types';

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const storage = await getStorage();
      const messages = await storage.searchMessages(searchQuery, 50);
      setResults(messages);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    performSearch(value);
  };

  const handleResultClick = (message: Message) => {
    navigate(`/chat/${message.conversationId}`);
  };

  return (
    <div className="flex flex-col h-full bg-primary-950/20 text-primary-50">
      {/* Header */}
      <div className="bg-primary-950/70 border-b border-primary-800/60 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div className="flex-1 relative">
            <input
              type="search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-full pl-10 pr-4 py-2 bg-primary-950/60 border border-primary-800 rounded-lg text-primary-100 placeholder-primary-300 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-primary-950 focus:border-transparent backdrop-blur"
              autoFocus
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isSearching ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-primary-200">Searching...</div>
          </div>
        ) : query && results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-primary-900/60 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <p className="text-primary-200">No results found</p>
            <p className="text-sm text-primary-300 mt-1">Try different keywords</p>
          </div>
        ) : !query ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-primary-900/60 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <p className="text-primary-200">Search messages</p>
            <p className="text-sm text-primary-300 mt-1">Find text in your conversations</p>
          </div>
        ) : (
          <div className="divide-y divide-primary-900/40">
            {results.map((message) => (
              <button
                key={message.id}
                onClick={() => handleResultClick(message)}
                className="w-full p-4 text-left hover:bg-primary-900/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-medium text-accent-300">
                    {message.sender.slice(0, 10)}...{message.sender.slice(-8)}
                  </div>
                  <div className="text-xs text-primary-300">
                    {formatMessageTime(message.sentAt)}
                  </div>
                </div>
                <p className="text-sm text-primary-100/90 line-clamp-2">{message.body}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      {results.length > 0 && (
        <div className="bg-primary-950/70 border-t border-primary-800/60 px-4 py-2 backdrop-blur-md">
          <p className="text-xs text-primary-300 text-center">
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </p>
        </div>
      )}
    </div>
  );
}

