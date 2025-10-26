/**
 * Chat list component
 */

import { Link } from 'react-router-dom';
import { useConversationStore } from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';

export function ChatList() {
  const { conversations, isLoading } = useConversationStore();

  // Sort: pinned first, then by lastMessageAt
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastMessageAt - a.lastMessageAt;
  });

  const activeConversations = sortedConversations.filter((c) => !c.archived);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading conversations...</div>
      </div>
    );
  }

  if (activeConversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-4">
          <svg
            className="w-10 h-10 text-slate-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">No conversations yet</h3>
        <p className="text-slate-400 mb-4">Start a new chat to begin messaging</p>
        <Link to="/new-chat" className="btn-primary">
          New Chat
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {activeConversations.map((conversation) => (
          <Link
            key={conversation.id}
            to={`/chat/${conversation.id}`}
            className="block border-b border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center px-4 py-3">
              {/* Avatar */}
              <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-semibold">
                  {conversation.peerId.slice(2, 4).toUpperCase()}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 ml-3">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="text-sm font-semibold truncate">
                    {conversation.peerId.slice(0, 10)}...{conversation.peerId.slice(-8)}
                  </h3>
                  <span className="text-xs text-slate-400 ml-2 flex-shrink-0">
                    {formatDistanceToNow(conversation.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400 truncate">
                    {conversation.lastMessagePreview || 'No messages yet'}
                  </p>
                  {conversation.unreadCount > 0 && (
                    <span className="ml-2 bg-primary-600 text-white text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Pin indicator */}
              {conversation.pinned && (
                <div className="ml-2">
                  <svg
                    className="w-4 h-4 text-slate-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1h-2z" />
                  </svg>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* New chat button */}
      <div className="p-4 border-t border-slate-700">
        <Link to="/new-chat" className="btn-primary w-full">
          + New Chat
        </Link>
      </div>
    </div>
  );
}

