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
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
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
              className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
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
            <div className="text-slate-400">Searching...</div>
          </div>
        ) : query && results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-slate-600"
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
            <p className="text-slate-400">No results found</p>
            <p className="text-sm text-slate-500 mt-1">Try different keywords</p>
          </div>
        ) : !query ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-slate-600"
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
            <p className="text-slate-400">Search messages</p>
            <p className="text-sm text-slate-500 mt-1">Find text in your conversations</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {results.map((message) => (
              <button
                key={message.id}
                onClick={() => handleResultClick(message)}
                className="w-full p-4 text-left hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-medium text-primary-500">
                    {message.sender.slice(0, 10)}...{message.sender.slice(-8)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatMessageTime(message.sentAt)}
                  </div>
                </div>
                <p className="text-sm text-slate-300 line-clamp-2">{message.body}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      {results.length > 0 && (
        <div className="bg-slate-800 border-t border-slate-700 px-4 py-2">
          <p className="text-xs text-slate-500 text-center">
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </p>
        </div>
      )}
    </div>
  );
}

