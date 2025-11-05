/**
 * Message composer component
 */

import { useState, useRef, KeyboardEvent } from 'react';
import type { Message } from '@/types';

interface MessageComposerProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  replyToMessage?: Message;
  onCancelReply?: () => void;
  onSent?: () => void;
}

export function MessageComposer({ onSend, disabled = false, replyToMessage, onCancelReply, onSent }: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    onSent?.();
    setMessage('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="border-t border-primary-900/40 bg-primary-950/40 p-4 backdrop-blur-md">
      <div className="flex flex-col gap-2">
        {replyToMessage && (
          <div className="flex items-center justify-between text-xs bg-primary-900/60 border border-primary-800/60 text-primary-200 px-3 py-1 rounded">
            <div className="truncate">
              Replying to: <span className="text-primary-100">{replyToMessage.body?.slice(0, 80) || 'message'}</span>
            </div>
            <button onClick={onCancelReply} className="ml-2 px-2 py-0.5 text-primary-200 hover:text-primary-50 hover:bg-primary-800/60 rounded">✕</button>
          </div>
        )}
        <div className="flex items-end gap-2">
        {/* Attachment button */}
        <button
          type="button"
          className="p-2 text-primary-300 hover:text-primary-100 hover:bg-primary-900/50 rounded-lg transition-colors flex-shrink-0"
          disabled={disabled}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>

        {/* Message input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="w-full px-4 py-2 bg-primary-950/60 border border-primary-800 rounded-lg text-primary-100 placeholder-primary-300 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-primary-950 focus:border-transparent resize-none overflow-y-auto backdrop-blur"
            rows={1}
            disabled={disabled}
            style={{ maxHeight: '120px' }}
          />
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="p-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-lg"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
        </div>
      </div>

    </div>
  );
}
