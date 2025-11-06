/**
 * Message bubble component
 */

import { Message } from '@/types';
import { formatMessageTime } from '@/lib/utils/date';
import { useAuthStore } from '@/lib/stores';
import { useState, useRef, useCallback } from 'react';
import { MessageActionsModal } from './MessageActionsModal';
import { useMessages } from './useMessages';

interface MessageBubbleProps {
  message: Message;
  onReplyRequest?: (message: Message) => void;
}

export function MessageBubble({ message, onReplyRequest }: MessageBubbleProps) {
  const { identity } = useAuthStore();
  const identityAddress = identity?.address?.toLowerCase();
  const identityInbox = identity?.inboxId?.toLowerCase();
  const senderLower = message.sender?.toLowerCase?.();
  const isSent = Boolean(
    (identityInbox && senderLower === identityInbox) ||
      (identityAddress && senderLower === identityAddress)
  );

  const { deleteMessage } = useMessages();
  const [showActions, setShowActions] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const openActions = useCallback(() => setShowActions(true), []);
  const closeActions = useCallback(() => setShowActions(false), []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openActions();
  };

  const handlePointerDown = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    // 500ms long-press
    pressTimer.current = window.setTimeout(() => openActions(), 500);
  };
  const clearTimer = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onCopy = async () => {
    if (message.type === 'text') {
      try {
        await navigator.clipboard.writeText(message.body);
      } catch (e) {
        console.warn('Clipboard write failed:', e);
      }
    }
    closeActions();
  };
  const onDelete = async () => {
    await deleteMessage(message.id);
    closeActions();
  };
  const onReply = () => {
    onReplyRequest?.(message);
    closeActions();
  };
  const onForward = () => {
    // TODO: wire a real forward action
    closeActions();
  };

  return (
    <div
      className={`flex mb-4 ${isSent ? 'justify-end' : 'justify-start'}`}
      onContextMenu={handleContextMenu}
    >
      <div
        className={`flex flex-col ${isSent ? 'items-end' : 'items-start'} max-w-[66%]`}
        onPointerDown={handlePointerDown}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
      >
        {/* Message content (bubble) */}
        <div
          className={
            (isSent ? 'message-sent' : 'message-received') +
            ' w-full relative ' +
            (message.reactions.length > 0 ? ' pb-5' : '')
          }
        >
          {message.type === 'text' && (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          )}
          {message.type === 'system' && (
            <div className="w-full flex justify-center">
              <div className="max-w-full text-center text-xs bg-primary-800/60 border border-primary-700 text-primary-200 px-2 py-1 rounded">
                {message.body}
              </div>
            </div>
          )}
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

          {/* Reactions tucked inside bubble bottom corner */}
          {message.reactions.length > 0 && (
            <div
              className={
                'absolute -bottom-2 flex gap-1 ' + (isSent ? 'left-2' : 'right-2')
              }
            >
              {message.reactions.map((reaction, idx) => (
                <span
                  key={idx}
                  className="text-xs bg-primary-900/70 px-2 py-0.5 rounded-full border border-primary-800/60 shadow"
                >
                  {reaction.emoji}
                </span>
              ))}
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

        {/* Reactions moved into bubble; nothing here */}
        <MessageActionsModal
          open={showActions}
          onClose={closeActions}
          conversationId={message.conversationId}
          message={message}
          onCopy={onCopy}
          onDelete={onDelete}
          onReply={onReply}
          onForward={onForward}
        />
      </div>
    </div>
  );
}
