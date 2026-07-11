/**
 * Message bubble component
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { Attachment, Message } from '@/types';
import { formatMessageTime } from '@/lib/utils/date';
import { useAuthStore, useMessageStore } from '@/lib/stores';
import { MessageActionsModal } from './MessageActionsModal';
import { useMessages } from './useMessages';
import { sanitizeAvatarGlyph, sanitizeImageSrc } from '@/lib/utils/image';
import { getStorage } from '@/lib/storage';
import { normalizeMentionLabel, tokenizeMessage } from '@/lib/utils/mentions';
import {
  ALLOWED_INCOMING_IMAGE_MIME_TYPES,
  classifyTrustedAttachmentHost,
  validateIncomingAttachmentContent,
  validateIncomingAttachmentUrl,
} from '@/lib/xmtp/incoming-attachment';

const SAFE_RASTER_MIME_TYPES = new Set<string>(ALLOWED_INCOMING_IMAGE_MIME_TYPES);

function isSafeRasterMimeType(mimeType?: string): boolean {
  return SAFE_RASTER_MIME_TYPES.has(mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '');
}

function attachmentErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/blocked for this conversation/i.test(message)) {
    return 'Images are blocked for this conversation.';
  }
  if (name === 'AttachmentConsentError' || /accept this conversation/i.test(message)) {
    return 'Accept this conversation before loading images.';
  }
  return 'Image could not be loaded.';
}

function isAttachmentConsentError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    name === 'AttachmentConsentError' ||
    /accept this conversation|blocked for this conversation/i.test(message)
  );
}

function isAttachmentConsentDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /blocked for this conversation/i.test(message);
}

function storedAttachmentStatusMessage(attachment: Attachment): string | null {
  if (attachment.cacheState === 'blocked') {
    return 'Image blocked for safety.';
  }
  if (attachment.cacheState !== 'failed') return null;
  return attachmentErrorMessage(new Error(attachment.failureReason ?? ''));
}

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
  const inviteExpired =
    Boolean(invitePayload?.expiresAt && invitePayload.expiresAt.getTime() < Date.now()) ||
    Boolean(
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

  const { allowConversation, deleteMessage, loadAttachment } = useMessages();
  const [showActions, setShowActions] = useState(false);
  const [attachmentMetadata, setAttachmentMetadata] = useState<Attachment | null>(null);
  const [attachmentData, setAttachmentData] = useState<ArrayBuffer | null>(null);
  const [attachmentMetadataLoaded, setAttachmentMetadataLoaded] = useState(false);
  const [attachmentLoadState, setAttachmentLoadState] = useState<'idle' | 'loading' | 'failed'>(
    'idle'
  );
  const [attachmentLoadError, setAttachmentLoadError] = useState<string | null>(null);
  const [attachmentNeedsConsent, setAttachmentNeedsConsent] = useState(false);
  const [attachmentConsentDenied, setAttachmentConsentDenied] = useState(false);
  const [attachmentContentBlocked, setAttachmentContentBlocked] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    url: string;
    filename: string;
    mimeType: string;
  } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const attachmentContainerRef = useRef<HTMLDivElement | null>(null);
  const autoLoadAttempted = useRef(false);

  useEffect(() => {
    let active = true;

    const loadStoredAttachment = async () => {
      setAttachmentMetadata(null);
      setAttachmentData(null);
      setAttachmentMetadataLoaded(false);
      setAttachmentLoadState('idle');
      setAttachmentLoadError(null);
      setAttachmentNeedsConsent(false);
      setAttachmentConsentDenied(false);
      setAttachmentContentBlocked(false);
      autoLoadAttempted.current = false;
      if (message.type !== 'attachment' || !message.attachmentId) {
        setAttachmentMetadataLoaded(true);
        return;
      }
      try {
        const storage = await getStorage();
        const [metadata, data] = await Promise.all([
          storage.getAttachmentMetadata(message.attachmentId),
          storage.getAttachmentData(message.attachmentId),
        ]);
        if (!active) return;
        setAttachmentMetadata(metadata ?? null);
        setAttachmentData(data ?? null);
      } catch (e) {
        console.warn('[MessageBubble] Failed to read attachment cache:', e);
      } finally {
        if (active) setAttachmentMetadataLoaded(true);
      }
    };

    void loadStoredAttachment();

    return () => {
      active = false;
    };
  }, [message.type, message.attachmentId]);

  useEffect(() => {
    setAttachmentContentBlocked(false);
    if (
      !attachmentMetadata ||
      !attachmentData ||
      !isSafeRasterMimeType(attachmentMetadata.mimeType) ||
      (attachmentMetadata.cacheState !== undefined && attachmentMetadata.cacheState !== 'cached')
    ) {
      setAttachmentPreview(null);
      return;
    }

    try {
      const validated = validateIncomingAttachmentContent({
        content: new Uint8Array(attachmentData),
        filename: attachmentMetadata.filename,
        mimeType: attachmentMetadata.mimeType,
      });
      const blob = new Blob([attachmentData], { type: validated.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      setAttachmentPreview({
        url: objectUrl,
        filename: attachmentMetadata.filename,
        mimeType: validated.mimeType,
      });
      return () => URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.warn('[MessageBubble] Cached attachment failed safety validation:', error);
      setAttachmentPreview(null);
      setAttachmentContentBlocked(true);
    }
  }, [attachmentData, attachmentMetadata]);

  const remoteAttachmentLocation = useMemo(() => {
    if (!attachmentMetadata?.storageRef) return null;
    try {
      const url = validateIncomingAttachmentUrl(attachmentMetadata.storageRef);
      return {
        hostname: url.hostname,
        trust: classifyTrustedAttachmentHost(url),
        valid: true,
      } as const;
    } catch {
      return {
        hostname: attachmentMetadata.sourceHost || 'unknown host',
        trust: 'untrusted',
        valid: false,
      } as const;
    }
  }, [attachmentMetadata?.sourceHost, attachmentMetadata?.storageRef]);

  const requestAttachment = useCallback(
    async (allowUntrusted: boolean, acceptConsent = false) => {
      if (!message.attachmentId || attachmentLoadState === 'loading') return;
      setAttachmentLoadState('loading');
      setAttachmentLoadError(null);
      try {
        if (acceptConsent) {
          await allowConversation(message.conversationId, true);
        }
        const loaded = await loadAttachment(message.conversationId, message.attachmentId, {
          allowUntrusted,
        });
        setAttachmentMetadata(loaded.attachment);
        setAttachmentData(loaded.data);
        setAttachmentLoadState('idle');
        setAttachmentNeedsConsent(false);
        setAttachmentConsentDenied(false);
      } catch (error) {
        setAttachmentLoadState('failed');
        setAttachmentLoadError(attachmentErrorMessage(error));
        setAttachmentNeedsConsent(isAttachmentConsentError(error));
        setAttachmentConsentDenied(isAttachmentConsentDeniedError(error));
      }
    },
    [
      allowConversation,
      attachmentLoadState,
      loadAttachment,
      message.attachmentId,
      message.conversationId,
    ]
  );

  useEffect(() => {
    if (
      message.type !== 'attachment' ||
      !attachmentMetadata ||
      attachmentData ||
      attachmentLoadState !== 'idle' ||
      attachmentMetadata.cacheState === 'blocked' ||
      attachmentMetadata.cacheState === 'failed' ||
      !remoteAttachmentLocation?.valid ||
      remoteAttachmentLocation.trust === 'untrusted' ||
      autoLoadAttempted.current ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const node = attachmentContainerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      autoLoadAttempted.current = true;
      observer.disconnect();
      void requestAttachment(false);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    attachmentData,
    attachmentLoadState,
    attachmentMetadata,
    message.type,
    remoteAttachmentLocation,
    requestAttachment,
  ]);

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
            requesterProfile: inviteMeta.requesterProfile,
            requesterMetadata: inviteMeta.requesterMetadata,
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
      return (
        <img
          src={safeAvatar}
          alt="Sender avatar"
          className="w-full h-full rounded-full object-cover"
        />
      );
    }
    const avatarGlyph = sanitizeAvatarGlyph(avatarUrl);
    if (avatarGlyph) {
      return (
        <span className="text-lg" aria-hidden>
          {avatarGlyph}
        </span>
      );
    }
    return (
      <span className="text-xs font-semibold text-white" aria-hidden>
        {fallbackLabel}
      </span>
    );
  };

  const shouldShowAvatar = Boolean(showAvatar && message.type !== 'system');
  const showLabel = Boolean(
    showSenderLabel && message.type !== 'system' && senderInfo?.displayName
  );

  const avatarClassName =
    'w-8 h-8 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0';

  const messagesByConversation = useMessageStore((state) => state.messagesByConversation);
  const replyTarget =
    message.replyTo && messagesByConversation[message.conversationId]
      ? messagesByConversation[message.conversationId].find((m) => m.id === message.replyTo)
      : undefined;

  const mentionTargets = useMemo(() => {
    const targets = new Set<string>();
    if (identity?.displayName) {
      targets.add(normalizeMentionLabel(identity.displayName));
    }
    if (identity?.address) {
      targets.add(identity.address.toLowerCase());
    }
    if (identity?.inboxId) {
      targets.add(identity.inboxId.toLowerCase());
    }
    return targets;
  }, [identity?.address, identity?.displayName, identity?.inboxId]);

  const messageTokens = useMemo(() => tokenizeMessage(message.body || ''), [message.body]);

  const parseMentionLabel = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return { display: '', key: '' };
    }
    const [displayPart, idPart] = trimmed.split('|');
    const display = (displayPart ?? '').trim();
    const key = (idPart ?? displayPart ?? '').trim();
    return { display, key };
  };

  const isMentioned = useMemo(() => {
    if (isSent || message.type !== 'text') {
      return false;
    }
    return messageTokens.some((token) => {
      if (token.type !== 'mention') return false;
      const { display, key } = parseMentionLabel(token.label);
      const normalizedDisplay = normalizeMentionLabel(display);
      const normalizedKey = key.toLowerCase();
      return Boolean(
        (normalizedDisplay && mentionTargets.has(normalizedDisplay)) ||
          (normalizedKey && mentionTargets.has(normalizedKey))
      );
    });
  }, [isSent, message.type, messageTokens, mentionTargets]);

  const renderTokens = () =>
    messageTokens.map((token, idx) => {
      if (token.type === 'link') {
        return (
          <a
            key={`link-${idx}`}
            href={token.value}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-accent-300 hover:text-accent-200 break-all"
          >
            {token.value}
          </a>
        );
      }
      if (token.type === 'mention') {
        const { display, key } = parseMentionLabel(token.label);
        const normalizedDisplay = normalizeMentionLabel(display);
        const normalizedKey = key.toLowerCase();
        const isTarget =
          (normalizedDisplay && mentionTargets.has(normalizedDisplay)) ||
          (normalizedKey && mentionTargets.has(normalizedKey));
        const mentionLabel = display || token.label;
        return (
          <span
            key={`mention-${idx}`}
            className={
              `inline-flex items-center px-1 rounded-md font-semibold ` +
              (isTarget
                ? 'bg-accent-500/20 text-accent-100 ring-1 ring-accent-300/50'
                : 'bg-accent-900/30 text-accent-200')
            }
          >
            @{mentionLabel}
          </span>
        );
      }
      return <span key={`text-${idx}`}>{token.value}</span>;
    });

  const attachmentImageSrc = attachmentPreview ? sanitizeImageSrc(attachmentPreview.url) : null;
  const storedAttachmentNeedsConsent = Boolean(
    attachmentMetadata?.cacheState === 'failed' &&
      isAttachmentConsentError(new Error(attachmentMetadata.failureReason ?? ''))
  );
  const storedAttachmentConsentDenied = Boolean(
    attachmentMetadata?.cacheState === 'failed' &&
      isAttachmentConsentDeniedError(new Error(attachmentMetadata.failureReason ?? ''))
  );
  const requiresAttachmentConsent = attachmentNeedsConsent || storedAttachmentNeedsConsent;
  const attachmentIsDenied = attachmentConsentDenied || storedAttachmentConsentDenied;

  return (
    <div
      className={`flex items-end gap-2 mb-4 ${isSent ? 'justify-end' : 'justify-start'}`}
      onContextMenu={handleContextMenu}
    >
      {!isSent &&
        shouldShowAvatar &&
        (onSenderClick ? (
          <button
            type="button"
            onClick={onSenderClick}
            className={`${avatarClassName} hover:ring-2 hover:ring-accent-400 transition-all focus:outline-none focus:ring-2 focus:ring-accent-400`}
            aria-label={
              senderInfo?.displayName ? `View contact ${senderInfo.displayName}` : 'View contact'
            }
          >
            {renderAvatar()}
          </button>
        ) : (
          <div className={avatarClassName}>{renderAvatar()}</div>
        ))}
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
            (message.reactions.length > 0 ? ' pb-7' : '') +
            (isMentioned
              ? ' ring-2 ring-accent-400/60 shadow-[0_0_12px_rgba(88,166,255,0.15)]'
              : '')
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
            <p className="whitespace-pre-wrap break-words">{renderTokens()}</p>
          )}
          {message.type === 'system' && (
            <div className="w-full flex justify-center">
              <div className="max-w-full text-center text-xs bg-primary-800/60 border border-primary-700 text-primary-200 px-2 py-1 rounded">
                <span className="whitespace-pre-wrap break-words">{renderTokens()}</span>
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
            <div ref={attachmentContainerRef} data-testid="attachment-frame" className="min-w-48">
              {attachmentImageSrc &&
              attachmentPreview &&
              isSafeRasterMimeType(attachmentPreview.mimeType) ? (
                <div className="flex flex-col gap-2">
                  <img
                    src={attachmentImageSrc}
                    alt={attachmentPreview.filename || 'Attachment'}
                    loading="lazy"
                    decoding="async"
                    className="max-h-64 w-full rounded-lg object-contain bg-primary-950/40"
                  />
                  <span className="text-xs text-primary-200 truncate">
                    {attachmentPreview.filename || message.body || 'Image'}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-5 h-5 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-sm truncate">
                      {attachmentMetadata?.filename || message.body || 'Attachment'}
                    </span>
                  </div>

                  {!attachmentMetadataLoaded && (
                    <span className="text-xs text-primary-300">Checking local image cache...</span>
                  )}

                  {attachmentMetadataLoaded && !attachmentMetadata && (
                    <span className="text-xs text-primary-300">
                      Image is unavailable on this device.
                    </span>
                  )}

                  {attachmentMetadata &&
                    attachmentData &&
                    !isSafeRasterMimeType(attachmentMetadata.mimeType) && (
                      <span className="text-xs text-primary-300">Unsupported attachment type.</span>
                    )}

                  {attachmentMetadata?.cacheState === 'blocked' && (
                    <span className="text-xs text-red-300">Image blocked for safety.</span>
                  )}

                  {attachmentContentBlocked &&
                    isSafeRasterMimeType(attachmentMetadata?.mimeType) && (
                      <span className="text-xs text-red-300">Image blocked for safety.</span>
                    )}

                  {attachmentMetadata &&
                    !attachmentData &&
                    attachmentMetadata.cacheState !== 'blocked' && (
                      <>
                        {(attachmentLoadError ||
                          storedAttachmentStatusMessage(attachmentMetadata)) && (
                          <span className="text-xs text-primary-300">
                            {attachmentLoadError ||
                              storedAttachmentStatusMessage(attachmentMetadata)}
                          </span>
                        )}

                        {attachmentLoadState === 'loading' ? (
                          <span className="text-xs text-primary-300">Loading image...</span>
                        ) : remoteAttachmentLocation?.valid ? (
                          requiresAttachmentConsent ? (
                            <button
                              type="button"
                              className="self-start text-xs font-medium text-accent-300 hover:text-accent-200 underline break-all text-left"
                              onClick={() =>
                                void requestAttachment(
                                  remoteAttachmentLocation.trust === 'untrusted',
                                  true,
                                )
                              }
                            >
                              {attachmentIsDenied
                                ? remoteAttachmentLocation.trust === 'untrusted'
                                  ? `Unblock and load from ${remoteAttachmentLocation.hostname}`
                                  : 'Unblock conversation and load image'
                                : remoteAttachmentLocation.trust === 'untrusted'
                                  ? `Accept and load from ${remoteAttachmentLocation.hostname}`
                                  : 'Accept conversation and load image'}
                            </button>
                          ) : remoteAttachmentLocation.trust === 'untrusted' ? (
                            <button
                              type="button"
                              className="self-start text-xs font-medium text-accent-300 hover:text-accent-200 underline break-all text-left"
                              onClick={() => void requestAttachment(true)}
                            >
                              {attachmentMetadata.cacheState === 'failed' ||
                              attachmentLoadState === 'failed'
                                ? `Retry image from ${remoteAttachmentLocation.hostname}`
                                : `Load image from ${remoteAttachmentLocation.hostname}`}
                            </button>
                          ) : attachmentMetadata.cacheState === 'failed' ||
                            attachmentLoadState === 'failed' ? (
                            <button
                              type="button"
                              className="self-start text-xs font-medium text-accent-300 hover:text-accent-200 underline"
                              onClick={() => void requestAttachment(false)}
                            >
                              Retry image
                            </button>
                          ) : typeof IntersectionObserver === 'undefined' ? (
                            <button
                              type="button"
                              className="self-start text-xs font-medium text-accent-300 hover:text-accent-200 underline"
                              onClick={() => void requestAttachment(false)}
                            >
                              Load image
                            </button>
                          ) : (
                            <span className="text-xs text-primary-300">
                              Image loads when visible.
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-red-300">
                            Image source blocked for safety.
                          </span>
                        )}
                      </>
                    )}
                </div>
              )}
            </div>
          )}

          {message.reactions.length > 0 &&
            (() => {
              const grouped = message.reactions.reduce<Record<string, number>>((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
              }, {});
              const entries = Object.entries(grouped);
              return (
                <div
                  className={'absolute -bottom-2 max-w-[85%] ' + (isSent ? 'left-2' : 'right-2')}
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
              {message.status === 'pending' && <span className="text-primary-300">○</span>}
              {message.status === 'sent' && <span className="text-primary-200">✓</span>}
              {message.status === 'delivered' && <span className="text-accent-300">✓✓</span>}
              {message.status === 'failed' && <span className="text-red-500">✗</span>}
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
      {isSent &&
        shouldShowAvatar &&
        (onSenderClick ? (
          <button
            type="button"
            onClick={onSenderClick}
            className={`${avatarClassName} hover:ring-2 hover:ring-accent-400 transition-all focus:outline-none focus:ring-2 focus:ring-accent-400`}
            aria-label={
              senderInfo?.displayName ? `View contact ${senderInfo.displayName}` : 'View contact'
            }
          >
            {renderAvatar()}
          </button>
        ) : (
          <div className={avatarClassName}>{renderAvatar()}</div>
        ))}
    </div>
  );
}
