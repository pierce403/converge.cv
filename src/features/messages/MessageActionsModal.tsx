import { useEffect, useState } from 'react';
import { getXmtpClient } from '@/lib/xmtp';
import { useMessages } from './useMessages';
import type { Message } from '@/types';

interface MessageActionsModalProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  message: Message;
  onCopy?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  onForward?: () => void;
}

export function MessageActionsModal({
  open,
  onClose,
  conversationId,
  message,
  onCopy,
  onDelete,
  onReply,
  onForward,
}: MessageActionsModalProps) {
  const { reactToMessage } = useMessages();
  const [details, setDetails] = useState<{
    id: string;
    senderInboxId?: string;
    sentAtNs?: bigint;
    deliveryStatus?: unknown;
    kind?: unknown;
    contentType?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const xmtp = getXmtpClient();
        const d = await xmtp.fetchMessageDetails(message.id);
        if (!mounted) return;
        setDetails(d);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (open) {
      load();
    }
    return () => {
      mounted = false;
    };
  }, [open, message.id]);

  if (!open) return null;

  const sentAt = new Date(message.sentAt);
  const sentAtText = isNaN(sentAt.getTime()) ? 'Unknown' : sentAt.toLocaleString();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="relative bg-primary-950 rounded-xl border border-primary-800/60 p-4 shadow-xl max-w-md w-full text-primary-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Message</h3>
          <button onClick={onClose} className="p-1 text-primary-300 hover:text-primary-100">
            ✕
          </button>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={onReply} className="btn-secondary text-sm">Reply</button>
          <button onClick={onForward} className="btn-secondary text-sm">Forward</button>
          <button onClick={onCopy} className="btn-secondary text-sm">Copy</button>
          <button onClick={onDelete} className="btn-danger text-sm">Delete</button>
        </div>

        {/* Quick Reactions */}
        <div className="mb-3">
          <div className="text-xs text-primary-300 mb-1">React</div>
          <div className="flex gap-2">
            {['😀','👍','❤️','🔥','🎉','👀','😮','😅'].map((emoji) => (
              <button
                key={emoji}
                className="px-2 py-1 rounded bg-primary-900/60 hover:bg-primary-800/70 border border-primary-800/60"
                onClick={async () => {
                  await reactToMessage(conversationId, message.id, emoji);
                  onClose();
                }}
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="bg-primary-900/50 border border-primary-800/60 rounded-lg p-3 text-sm space-y-1">
          <div><span className="text-primary-300">Message ID:</span> <code className="font-mono break-all">{message.id}</code></div>
          <div><span className="text-primary-300">Conversation ID:</span> <code className="font-mono break-all">{conversationId}</code></div>
          <div><span className="text-primary-300">Sender:</span> <code className="font-mono break-all">{message.sender}</code></div>
          <div><span className="text-primary-300">Sent at:</span> {sentAtText}</div>
          {details && (
            <>
              {details.senderInboxId && (
                <div><span className="text-primary-300">Sender Inbox:</span> <code className="font-mono break-all">{details.senderInboxId}</code></div>
              )}
              {details.contentType && (
                <div><span className="text-primary-300">Content Type:</span> <code className="font-mono break-all">{details.contentType}</code></div>
              )}
              {typeof details.sentAtNs !== 'undefined' && (
                <div><span className="text-primary-300">sentAtNs:</span> <code className="font-mono">{details.sentAtNs?.toString()}</code></div>
              )}
              {typeof details.kind !== 'undefined' && (
                <div><span className="text-primary-300">Kind:</span> <code className="font-mono break-all">{String(details.kind)}</code></div>
              )}
              {typeof details.deliveryStatus !== 'undefined' && (
                <div><span className="text-primary-300">Delivery:</span> <code className="font-mono break-all">{String(details.deliveryStatus)}</code></div>
              )}
            </>
          )}
          {error && (
            <div className="text-red-400">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
