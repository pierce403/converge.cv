import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores';
import {
  extractConvosInviteCode,
  parseConvosInvite,
  sanitizeConvosInviteCode,
  type ParsedConvosInvite,
} from '@/lib/utils/convos-invite';
import { useConversations } from '@/features/conversations/useConversations';
import { useMessages } from '@/features/messages/useMessages';

export function InviteClaimPage() {
  const navigate = useNavigate();
  const { code } = useParams<{ code?: string }>();
  const [searchParams] = useSearchParams();
  const initialInput = code || searchParams.get('i') || '';
  const autoClaimRequested = searchParams.get('auto') === '1';

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isVaultUnlocked = useAuthStore((state) => state.isVaultUnlocked);

  const { createConversation } = useConversations();
  const { sendMessage } = useMessages();

  const [input, setInput] = useState(initialInput);
  const [parsed, setParsed] = useState<ParsedConvosInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const sanitizedInput = useMemo(() => {
    const extracted = extractConvosInviteCode(input);
    return extracted ? sanitizeConvosInviteCode(extracted) : '';
  }, [input]);

  useEffect(() => {
    if (!input.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    try {
      const parsedInvite = parseConvosInvite(input);
      setParsed(parsedInvite);
      setError(null);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'Invalid invite code.');
    }
  }, [input]);

  const handleClaim = useCallback(async () => {
    if (!parsed) {
      setError('Paste a valid invite code first.');
      return;
    }
    if (!isAuthenticated || !isVaultUnlocked) {
      setError('Sign in and unlock your inbox before claiming an invite.');
      return;
    }
    if (!parsed.payload.creatorInboxId) {
      setError('Invite is missing the creator inbox ID.');
      return;
    }

    setSending(true);
    try {
      const conversation = await createConversation(parsed.payload.creatorInboxId);
      if (!conversation) {
        throw new Error('Failed to create DM with the invite creator.');
      }

      await sendMessage(conversation.id, parsed.inviteCode);
      try {
        window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Invite sent. Waiting for approval.' }));
      } catch {
        // ignore toast errors
      }
      navigate(`/chat/${conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setSending(false);
    }
  }, [createConversation, isAuthenticated, isVaultUnlocked, navigate, parsed, sendMessage]);

  const autoClaimedRef = useRef(false);

  useEffect(() => {
    if (!autoClaimRequested) return;
    if (autoClaimedRef.current) return;
    if (!parsed) return;
    if (!isAuthenticated || !isVaultUnlocked) return;
    autoClaimedRef.current = true;
    void handleClaim();
  }, [autoClaimRequested, handleClaim, isAuthenticated, isVaultUnlocked, parsed]);

  return (
    <div className="min-h-full bg-primary-950/90 text-primary-50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Claim Group Invite</h1>
          <p className="text-sm text-primary-300">
            Paste an invite link or code to request access. We will DM the group creator for approval.
          </p>
        </header>

        <div className="space-y-3">
          <label className="text-sm text-primary-200">Invite link or code</label>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-primary-800/60 bg-primary-950 px-3 py-2 text-sm text-primary-100"
            placeholder="Paste https://popup.convos.org/v2?i=... or the raw invite code"
          />
          {sanitizedInput && (
            <div className="text-xs text-primary-400 break-all">
              Sanitized code: {sanitizedInput}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {parsed && (
          <div className="rounded-lg border border-primary-800/60 bg-primary-900/40 p-4 text-sm space-y-2">
            <div>
              <span className="text-primary-300">Group name:</span> {parsed.payload.name || '—'}
            </div>
            <div>
              <span className="text-primary-300">Creator inbox:</span> <span className="break-all">{parsed.payload.creatorInboxId}</span>
            </div>
            <div>
              <span className="text-primary-300">Invite tag:</span> {parsed.payload.tag || '—'}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleClaim}
            disabled={sending || !parsed}
            className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : 'Send invite request'}
          </button>
          <button
            onClick={() => navigate('/')}
            className="rounded-lg border border-primary-700/70 px-4 py-2 text-sm text-primary-200 hover:bg-primary-900/60"
          >
            Back to inbox
          </button>
        </div>
      </div>
    </div>
  );
}
