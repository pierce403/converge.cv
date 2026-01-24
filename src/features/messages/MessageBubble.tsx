/**
 * Message bubble component
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Message } from '@/types';
import { formatMessageTime } from '@/lib/utils/date';
import { useAuthStore, useMessageStore } from '@/lib/stores';
import { MessageActionsModal } from './MessageActionsModal';
import { useMessages } from './useMessages';
import { sanitizeImageSrc } from '@/lib/utils/image';
import { getStorage } from '@/lib/storage';

interface SenderInfo {
  displayName?: string;
  avatarUrl?: string;
  fallback?: string;
}

interface MessageBubbleProps {
  message: Message;
  onReplyRequest?: (message: Message) => void;
  senderInfo?: SenderInfo;
  showAvatar?: boolean;
  showSenderLabel?: boolean;
  onSenderClick?: () => void;
}

export function MessageBubble({
  message,
  onReplyRequest,
  senderInfo,
  showAvatar = false,
  showSenderLabel = false,
  onSenderClick,
}: MessageBubbleProps) {
  const { identity } = useAuthStore();
  const identityAddress = identity?.address?.toLowerCase();
  const identityInbox = identity?.inboxId?.toLowerCase();
  const senderLower = message.sender?.toLowerCase?.();
  const isSent = Boolean(
    (identityInbox && senderLower === identityInbox) ||
      (identityAddress && senderLower === identityAddress)
  );
  const inviteMeta = message.metadata?.invite;
  const isInviteRequest = Boolean(
    message.type === 'system' &&
      inviteMeta &&
      inviteMeta.kind === 'invite-request' &&
      inviteMeta.inviteCode &&
      inviteMeta.payload
  );
  const invitePayload = inviteMeta?.payload;
  const isInviteCreator =
    Boolean(identityInbox && invitePayload?.creatorInboxId) &&
    invitePayload!.creatorInboxId.toLowerCase() === identityInbox;
  const inviteExpired = Boolean(
    invitePayload?.expiresAt && invitePayload.expiresAt.getTime() < Date.now()
  ) || Boolean(
    invitePayload?.conversationExpiresAt &&
      invitePayload.conversationExpiresAt.getTime() < Date.now()
  );
  const canApproveInvite = Boolean(isInviteRequest && !isSent && isInviteCreator && !inviteExpired);
  const inviteStatusHint =
    !isInviteRequest || isSent
      ? undefined
      : !isInviteCreator
        ? 'Only the invite creator can approve.'
        : inviteExpired
          ? 'Invite expired.'
          : undefined;

  const { deleteMessage } = useMessages();
  const [showActions, setShowActions] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    url: string;
    filename: string;
    mimeType: string;
  } | null>(null);
  const pressTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadAttachment = async () => {
      if (message.type !== 'attachment' || !message.attachmentId) {
        setAttachmentPreview(null);
        return;
      }
      try {
        const storage = await getStorage();
        const stored = await storage.getAttachment(message.attachmentId);
        if (!stored) {
          setAttachmentPreview(null);
          return;
        }
        const blob = new Blob([stored.data], { type: stored.attachment.mimeType });
        objectUrl = URL.createObjectURL(blob);
        if (!active) return;
        setAttachmentPreview({
          url: objectUrl,
          filename: stored.attachment.filename,
          mimeType: stored.attachment.mimeType,
        });
      } catch (e) {
        console.warn('[MessageBubble] Failed to load attachment:', e);
        if (active) {
          setAttachmentPreview(null);
        }
      }
    };

    void loadAttachment();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [message.type, message.attachmentId]);

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

  const dispatchInviteAction = useCallback(
    (action: 'approve' | 'reject' | 'open') => {
      if (!inviteMeta || !invitePayload || typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent(`ui:invite-${action}`, {
          detail: {
            conversationId: message.conversationId,
            senderInboxId: message.sender,
            messageId: message.id,
            inviteCode: inviteMeta.inviteCode,
            payload: invitePayload,
            receivedAt: message.sentAt,
          },
        })
      );
    },
    [inviteMeta, invitePayload, message.conversationId, message.id, message.sender, message.sentAt]
  );

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

  const fallbackSource = senderInfo?.fallback || senderInfo?.displayName || message.sender || '';
  const fallbackLabel = (() => {
    const trimmed = fallbackSource.trim();
    if (!trimmed) {
      return '??';
    }
    if (trimmed.startsWith('0x') && trimmed.length > 4) {
      return trimmed.slice(2, 4).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  })();

  const renderAvatar = () => {
    const avatarUrl = senderInfo?.avatarUrl;
    const safeAvatar = sanitizeImageSrc(avatarUrl);
    if (safeAvatar) {
      return <img src={safeAvatar} alt="Sender avatar" className="w-full h-full rounded-full object-cover" />;
    }
    if (avatarUrl) {
      return <span className="text-lg" aria-hidden>{avatarUrl}</span>;
    }
    return (
      <span className="text-xs font-semibold text-white" aria-hidden>
        {fallbackLabel}
      </span>
    );
  };

  const shouldShowAvatar = Boolean(showAvatar && message.type !== 'system');
  const showLabel = Boolean(showSenderLabel && message.type !== 'system' && senderInfo?.displayName);

  const avatarClassName =
    'w-8 h-8 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0';

  const messagesByConversation = useMessageStore((state) => state.messagesByConversation);
  const replyTarget =
    message.replyTo && messagesByConversation[message.conversationId]
      ? messagesByConversation[message.conversationId].find((m) => m.id === message.replyTo)
      : undefined;

  const renderLinkifiedText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const segments: Array<{ type: 'text' | 'link'; value: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'link', value: match[0] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return segments.map((seg, idx) =>
      seg.type === 'link' ? (
        <a
          key={`link-${idx}`}
          href={seg.value}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-accent-300 hover:text-accent-200 break-all"
        >
          {seg.value}
        </a>
      ) : (
        <span key={`text-${idx}`}>{seg.value}</span>
      )
    );
  };

  const attachmentImageSrc = attachmentPreview ? sanitizeImageSrc(attachmentPreview.url) : null;

  return (
    <div
      className={`flex items-end gap-2 mb-4 ${isSent ? 'justify-end' : 'justify-start'}`}
      onContextMenu={handleContextMenu}
    >
      {!isSent && shouldShowAvatar && (
        onSenderClick ? (
          <button
            type="button"
            onClick={onSenderClick}
            className={`${avatarClassName} hover:ring-2 hover:ring-accent-400 transition-all focus:outline-none focus:ring-2 focus:ring-accent-400`}
            aria-label={senderInfo?.displayName ? `View contact ${senderInfo.displayName}` : 'View contact'}
          >
            {renderAvatar()}
          </button>
        ) : (
          <div className={avatarClassName}>{renderAvatar()}</div>
        )
      )}
      <div
        className={`flex flex-col ${isSent ? 'items-end' : 'items-start'} max-w-[66%]`}
        onPointerDown={handlePointerDown}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
      >
        {showLabel && (
          <span
            className={`text-xs text-primary-300 mb-1 px-1 ${isSent ? 'self-end text-right' : 'self-start'}`}
          >
            {senderInfo?.displayName}
          </span>
        )}
        <div
          className={
            (isSent ? 'message-sent' : 'message-received') +
            ' w-full relative ' +
            (message.reactions.length > 0 ? ' pb-7' : '')
          }
        >
          {message.replyTo && (
            <div className="mb-1 max-w-full rounded-lg border border-primary-700/70 bg-primary-950/60 px-2 py-1 text-xs text-primary-200">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-primary-400">
                Replying to
              </div>
              <div className="mt-0.5 line-clamp-2 break-words text-primary-100">
                {replyTarget?.body || 'Original message'}
              </div>
            </div>
          )}
          {message.type === 'text' && (
            <p className="whitespace-pre-wrap break-words">
              {renderLinkifiedText(message.body)}
            </p>
          )}
          {message.type === 'system' && (
            <div className="w-full flex justify-center">
              <div className="max-w-full text-center text-xs bg-primary-800/60 border border-primary-700 text-primary-200 px-2 py-1 rounded">
                <span className="whitespace-pre-wrap break-words">
                  {renderLinkifiedText(message.body)}
                </span>
                {isInviteRequest && !isSent && (
                  <div className="mt-2 flex flex-col items-center gap-2">
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold ${
                          canApproveInvite
                            ? 'bg-accent-500 text-white hover:bg-accent-400'
                            : 'bg-primary-900/60 text-primary-400 cursor-not-allowed'
                        }`}
                        onClick={() => dispatchInviteAction('approve')}
                        disabled={!canApproveInvite}
                      >
                        Accept
                      </button>
                      <button
                        className="px-2 py-1 rounded-md text-[11px] border border-primary-600/60 text-primary-200 hover:bg-primary-900/50"
                        onClick={() => dispatchInviteAction('reject')}
                      >
                        Reject
                      </button>
                      <button
                        className="px-2 py-1 rounded-md text-[11px] border border-primary-600/60 text-primary-300 hover:bg-primary-900/50"
                        onClick={() => dispatchInviteAction('open')}
                      >
                        Review
                      </button>
                    </div>
                    {inviteStatusHint && (
                      <span className="text-[10px] text-primary-400">{inviteStatusHint}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {message.type === 'attachment' && (
            attachmentImageSrc && attachmentPreview?.mimeType.startsWith('image/') ? (
              <div className="flex flex-col gap-2">
                <a href={attachmentImageSrc} target="_blank" rel="noopener noreferrer">
                  <img
                    src={attachmentImageSrc}
                    alt={attachmentPreview.filename || 'Attachment'}
                    className="max-h-64 w-full rounded-lg object-contain bg-primary-950/40"
                  />
                </a>
                <span className="text-xs text-primary-200 truncate">
                  {attachmentPreview.filename || message.body || 'Image'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm">{message.body || 'Attachment'}</span>
              </div>
            )
          )}

          {message.reactions.length > 0 && (() => {
            const grouped = message.reactions.reduce<Record<string, number>>((acc, r) => {
              acc[r.emoji] = (acc[r.emoji] || 0) + 1;
              return acc;
            }, {});
            const entries = Object.entries(grouped);
            return (
              <div
                className={
                  'absolute -bottom-2 max-w-[85%] ' +
                  (isSent ? 'left-2' : 'right-2')
                }
              >
                <div
                  className={
                    'inline-flex flex-wrap items-center gap-1 px-1.5 py-1 rounded-xl ' +
                    'bg-primary-950/50 border border-primary-800/40 backdrop-blur-sm shadow'
                  }
                >
                  {entries.map(([emoji, count]) => (
                    <span
                      key={emoji}
                      className="text-xs px-1.5 py-0.5 rounded-full flex items-center bg-primary-900/20"
                    >
                      <span className="leading-none">{emoji}</span>
                      {count > 1 && (
                        <span className="ml-1 text-[10px] leading-none opacity-80">{count}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

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
      {isSent && shouldShowAvatar && (
        onSenderClick ? (
          <button
            type="button"
            onClick={onSenderClick}
            className={`${avatarClassName} hover:ring-2 hover:ring-accent-400 transition-all focus:outline-none focus:ring-2 focus:ring-accent-400`}
            aria-label={senderInfo?.displayName ? `View contact ${senderInfo.displayName}` : 'View contact'}
          >
            {renderAvatar()}
          </button>
        ) : (
          <div className={avatarClassName}>{renderAvatar()}</div>
        )
      )}
    </div>
  );
}
