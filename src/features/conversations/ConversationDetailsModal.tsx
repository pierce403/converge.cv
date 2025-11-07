import { useEffect, useMemo, useState } from 'react';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import type { Conversation } from '@/types';

interface Props {
  conversationId: string;
  onClose: () => void;
}

export function ConversationDetailsModal({ conversationId, onClose }: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [groupDetails, setGroupDetails] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const storage = await getStorage();
        const conv = await storage.getConversation(conversationId);
        if (conv) setConversation(conv);
        if (conv?.isGroup) {
          try {
            const xmtp = getXmtpClient();
            const details = await xmtp.fetchGroupDetails(conversationId);
            setGroupDetails(details);
          } catch (e) {
            setGroupDetails(null);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    run();
  }, [conversationId]);

  const prettyConv = useMemo(() => {
    try {
      return conversation ? JSON.stringify(conversation, null, 2) : '';
    } catch {
      return '';
    }
  }, [conversation]);

  const prettyGroup = useMemo(() => {
    try {
      return groupDetails ? JSON.stringify(groupDetails, null, 2) : '';
    } catch {
      return '';
    }
  }, [groupDetails]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-primary-800/60 bg-primary-950/95 p-6 text-primary-100 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-primary-300 transition-colors hover:bg-primary-900/60 hover:text-primary-100"
          aria-label="Close details"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-white mb-4">Conversation Details</h2>
        {error && (
          <div className="mb-3 text-sm text-red-400">{error}</div>
        )}
        {conversation ? (
          <div className="space-y-2 text-sm">
            <div><span className="text-primary-300">ID:</span> {conversation.id}</div>
            <div><span className="text-primary-300">Peer/Group ID:</span> {conversation.peerId}</div>
            <div><span className="text-primary-300">Topic:</span> {conversation.topic}</div>
            <div><span className="text-primary-300">Type:</span> {conversation.isGroup ? 'Group' : 'Direct Message'}</div>
            <div><span className="text-primary-300">Last Message:</span> {new Date(conversation.lastMessageAt).toLocaleString()}</div>
            {conversation.isGroup && (
              <div className="mt-3">
                <div className="text-primary-300">Group Metadata (live)</div>
                {prettyGroup ? (
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-primary-900/70 p-3 text-xs whitespace-pre-wrap">{prettyGroup}</pre>
                ) : (
                  <div className="text-primary-300 text-xs">No extra group metadata available</div>
                )}
              </div>
            )}
            <div className="mt-3">
              <div className="text-primary-300">Stored Conversation Object</div>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-primary-900/70 p-3 text-xs whitespace-pre-wrap">{prettyConv}</pre>
            </div>
          </div>
        ) : (
          <div className="text-primary-300">Loading…</div>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
}

