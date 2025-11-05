/**
 * Message bubble component
 */

import { Message } from '@/types';
import { formatMessageTime } from '@/lib/utils/date';
import { useAuthStore } from '@/lib/stores';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { identity } = useAuthStore();
  const identityAddress = identity?.address?.toLowerCase();
  const isSent =
    identityAddress !== undefined &&
    message.sender?.toLowerCase() === identityAddress;

  return (
    <div className={`flex mb-4 ${isSent ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isSent ? 'items-end' : 'items-start'} max-w-[66%]`}>
        {/* Message content */}
        <div className={isSent ? 'message-sent' : 'message-received'}>
          {message.type === 'text' && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
          {message.type === 'attachment' && (
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm">Attachment</span>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 mt-1 px-2">
          <span className="text-xs text-primary-300">{formatMessageTime(message.sentAt)}</span>

          {isSent && (
            <span className="text-xs">
              {message.status === 'pending' && (
                <span className="text-primary-300">○</span>
              )}
              {message.status === 'sent' && (
                <span className="text-primary-200">✓</span>
              )}
              {message.status === 'delivered' && (
                <span className="text-accent-300">✓✓</span>
              )}
              {message.status === 'failed' && (
                <span className="text-red-500">✗</span>
              )}
            </span>
          )}
        </div>

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="flex gap-1 mt-1">
            {message.reactions.map((reaction, idx) => (
              <span key={idx} className="text-sm bg-primary-900/60 px-2 py-0.5 rounded-full">
                {reaction.emoji}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
