import { useEffect, useState } from 'react';
import { getXmtpClient, type ConvosInviteResult } from '@/lib/xmtp';

interface Props {
  conversationId: string;
  conversationName?: string;
  onClose: () => void;
}

export function GroupInviteModal({ conversationId, conversationName, onClose }: Props) {
  const [invite, setInvite] = useState<ConvosInviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setError(null);
      setIsLoading(true);
      try {
        const xmtp = getXmtpClient();
        const created = await xmtp.createConvosInvite(conversationId);
        if (mounted) {
          setInvite(created);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to generate invite.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [conversationId]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://converge.cv';
  const convosUrl = invite ? `https://popup.convos.org/v2?i=${invite.inviteCode}` : '';
  const convergeUrl = invite ? `${origin}/invite?i=${invite.inviteCode}` : '';

  const copyValue = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      try {
        window.dispatchEvent(new CustomEvent('ui:toast', { detail: `${label} copied` }));
      } catch {
        // ignore toast errors
      }
    } catch (err) {
      alert('Copy failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-2xl border border-primary-800/60 bg-primary-950/95 p-6 text-primary-100 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-primary-300 transition-colors hover:bg-primary-900/60 hover:text-primary-100"
          aria-label="Close invite modal"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-white mb-2">Group Invite</h2>
        <p className="text-sm text-primary-300 mb-4">
          Share this invite so someone can request access to{conversationName ? ` ${conversationName}` : ' the group'}.
        </p>

        {isLoading && (
          <div className="text-sm text-primary-300">Generating invite…</div>
        )}

        {error && (
          <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {invite && !isLoading && (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary-800/60 bg-primary-900/40 px-4 py-3 text-sm">
              <div className="text-primary-300">Invite tag</div>
              <div className="mt-1 font-mono text-primary-50">{invite.payload.tag || '—'}</div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => copyValue('Convos link', convosUrl)}
                className="w-full rounded-lg border border-primary-700/70 bg-primary-900/60 px-3 py-2 text-sm text-primary-100 transition hover:bg-primary-800/70"
              >
                Copy Convos link
              </button>
              <button
                onClick={() => copyValue('Converge link', convergeUrl)}
                className="w-full rounded-lg border border-primary-700/70 bg-primary-900/60 px-3 py-2 text-sm text-primary-100 transition hover:bg-primary-800/70"
              >
                Copy Converge link
              </button>
              <button
                onClick={() => copyValue('Invite code', invite.inviteCode)}
                className="w-full rounded-lg border border-primary-700/70 bg-primary-900/60 px-3 py-2 text-sm text-primary-100 transition hover:bg-primary-800/70"
              >
                Copy raw code
              </button>
            </div>

            <div>
              <div className="text-xs text-primary-400 mb-1">Raw invite code</div>
              <textarea
                readOnly
                value={invite.inviteCode}
                className="w-full rounded-lg border border-primary-800/60 bg-primary-950 px-3 py-2 text-xs text-primary-200 font-mono"
                rows={4}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
