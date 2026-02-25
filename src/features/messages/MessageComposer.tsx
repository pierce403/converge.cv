/**
 * Message composer component
 */

import { useState, useRef, KeyboardEvent, useMemo, useEffect } from 'react';
import type { Message } from '@/types';
import { formatMention, type MentionCandidate } from '@/lib/utils/mentions';
import { sanitizeImageSrc } from '@/lib/utils/image';

interface MessageComposerProps {
  onSend: (content: string) => void;
  onSendAttachment?: (file: File) => void;
  disabled?: boolean;
  replyToMessage?: Message;
  onCancelReply?: () => void;
  onSent?: () => void;
  mentionCandidates?: MentionCandidate[];
}

export function MessageComposer({
  onSend,
  onSendAttachment,
  disabled = false,
  replyToMessage,
  onCancelReply,
  onSent,
  mentionCandidates = [],
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [mentionState, setMentionState] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mentionResults = useMemo(() => {
    if (!mentionState || mentionCandidates.length === 0) return [];
    const query = mentionState.query.trim().toLowerCase();
    const matches = query.length
      ? mentionCandidates.filter((candidate) => {
        const display = candidate.display.toLowerCase();
        const secondary = candidate.secondary?.toLowerCase();
        return display.includes(query) || Boolean(secondary && secondary.includes(query));
      })
      : mentionCandidates;
    return matches.slice(0, 8);
  }, [mentionState, mentionCandidates]);

  const isMentionMenuOpen = Boolean(mentionState && mentionResults.length > 0);

  useEffect(() => {
    if (!mentionState) {
      setMentionIndex(0);
      return;
    }
    if (mentionIndex >= mentionResults.length) {
      setMentionIndex(0);
    }
  }, [mentionState, mentionResults.length, mentionIndex]);

  const updateTextareaHeight = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  };

  const updateMentionState = (value: string, cursor: number | null) => {
    if (!mentionCandidates.length || cursor === null) {
      setMentionState(null);
      return;
    }

    const beforeCursor = value.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf('@');
    if (atIndex === -1) {
      setMentionState(null);
      return;
    }

    const prevChar = atIndex > 0 ? beforeCursor[atIndex - 1] : '';
    if (prevChar && !/[\s([{"'`]/.test(prevChar)) {
      setMentionState(null);
      return;
    }

    const afterAt = beforeCursor.slice(atIndex + 1);
    if (!afterAt.length) {
      setMentionState({ start: atIndex, end: cursor, query: '' });
      return;
    }

    if (afterAt.startsWith('{')) {
      const closingIndex = afterAt.indexOf('}');
      if (closingIndex !== -1) {
        setMentionState(null);
        return;
      }
      const query = afterAt.slice(1);
      setMentionState({ start: atIndex, end: cursor, query });
      return;
    }

    if (!/^[A-Za-z0-9._-]+$/.test(afterAt)) {
      setMentionState(null);
      return;
    }

    setMentionState({ start: atIndex, end: cursor, query: afterAt });
  };

  const insertMention = (candidate: MentionCandidate) => {
    if (!mentionState) return;
    const mentionText = formatMention(candidate.display);
    const before = message.slice(0, mentionState.start);
    const after = message.slice(mentionState.end);
    const needsSpace = after.length === 0 || !after.startsWith(' ');
    const spacer = needsSpace ? ' ' : '';
    const nextMessage = `${before}${mentionText}${spacer}${after}`;
    const nextCursor = before.length + mentionText.length + spacer.length;

    setMessage(nextMessage);
    setMentionState(null);
    setMentionIndex(0);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      updateTextareaHeight(textarea);
    });
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    onSent?.();
    setMessage('');
    setMentionState(null);
    setMentionIndex(0);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSendPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Keep focus in the textarea on mobile so tapping send doesn't first dismiss
    // the keyboard and swallow the click event.
    e.preventDefault();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMentionMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selection = mentionResults[mentionIndex];
        if (selection) {
          insertMention(selection);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    // Auto-resize textarea
    updateTextareaHeight(e.target);

    updateMentionState(e.target.value, e.target.selectionStart);
  };

  const handleAttachmentClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onSendAttachment?.(file);
    onSent?.();
    // Reset input so selecting the same file again triggers change
    e.target.value = '';
  };

  const renderMentionAvatar = (candidate: MentionCandidate) => {
    const safeAvatar = sanitizeImageSrc(candidate.avatarUrl);
    if (safeAvatar) {
      return (
        <img src={safeAvatar} alt={candidate.display} className="w-8 h-8 rounded-full object-cover" />
      );
    }

    const label = candidate.display.trim();
    const initial = label
      ? (label.startsWith('0x') ? label.slice(2, 4).toUpperCase() : label.slice(0, 2).toUpperCase())
      : '??';
    return (
      <div className="w-8 h-8 rounded-full bg-primary-800/70 flex items-center justify-center text-xs font-semibold text-primary-50">
        {initial}
      </div>
    );
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
        <div className="flex items-center gap-2">
          {/* Attachment button */}
          <button
            type="button"
            className="h-[44px] w-[44px] flex items-center justify-center text-primary-300 hover:text-primary-100 hover:bg-primary-900/50 rounded-lg transition-colors flex-shrink-0 border border-transparent"
            disabled={disabled}
            onClick={handleAttachmentClick}
            aria-label="Attach image"
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAttachmentChange}
          />

          {/* Message input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onClick={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyUp={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
              placeholder="Type a message..."
              className="w-full px-4 py-2.5 min-h-[44px] bg-primary-950/60 border border-primary-800 rounded-lg text-primary-100 placeholder-primary-300 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-primary-950 focus:border-transparent resize-none overflow-y-auto backdrop-blur"
              rows={1}
              disabled={disabled}
              style={{ maxHeight: '120px' }}
            />
            {isMentionMenuOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-2 rounded-lg border border-primary-800/80 bg-primary-950/95 shadow-xl backdrop-blur z-50 overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  {mentionResults.map((candidate, index) => {
                    const active = index === mentionIndex;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertMention(candidate)}
                        className={
                          `w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                            active ? 'bg-primary-800/80 text-primary-50' : 'text-primary-200 hover:bg-primary-900/60'
                          }`
                        }
                      >
                        {renderMentionAvatar(candidate)}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{candidate.display}</div>
                          {candidate.secondary && (
                            <div className="text-xs text-primary-400 truncate">{candidate.secondary}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            onPointerDown={handleSendPointerDown}
            disabled={disabled || !message.trim()}
            aria-label="Send message"
            className="h-[44px] w-[44px] flex items-center justify-center bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-lg border border-transparent"
          >
            <svg className="w-6 h-6 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
