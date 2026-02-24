import { useEffect, useMemo, useState } from 'react';
import {
  WALLET_SIGNATURE_STATUS_EVENT,
  type WalletSignatureStatusDetail,
} from '@/lib/wagmi/signature-status';

type PendingSignatureRequest = {
  id: string;
  provider: string;
  startedAt: number;
  messagePreview: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  native: 'External Wallet',
  thirdweb: 'Thirdweb Wallet',
  privy: 'Privy Wallet',
  unknown: 'Wallet',
};

function formatElapsed(startedAt: number, now: number): string {
  const elapsedMs = Math.max(0, now - startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  return `${minutes}m ${remainderSeconds}s`;
}

export function WalletSignatureModal() {
  const [pendingById, setPendingById] = useState<Record<string, PendingSignatureRequest>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<WalletSignatureStatusDetail | undefined>).detail;
      if (!detail || !detail.id) return;

      if (detail.state === 'pending') {
        setPendingById((prev) => ({
          ...prev,
          [detail.id]: {
            id: detail.id,
            provider: detail.provider,
            startedAt: detail.startedAt,
            messagePreview: detail.messagePreview,
          },
        }));
        return;
      }

      setPendingById((prev) => {
        if (!prev[detail.id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[detail.id];
        return next;
      });
    };

    window.addEventListener(WALLET_SIGNATURE_STATUS_EVENT, onStatus as EventListener);
    return () => window.removeEventListener(WALLET_SIGNATURE_STATUS_EVENT, onStatus as EventListener);
  }, []);

  useEffect(() => {
    const hasPending = Object.keys(pendingById).length > 0;
    if (!hasPending) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingById]);

  const pendingRequests = useMemo(
    () => Object.values(pendingById).sort((a, b) => a.startedAt - b.startedAt),
    [pendingById]
  );

  if (pendingRequests.length === 0) {
    return null;
  }

  const active = pendingRequests[0];
  const providerLabel = PROVIDER_LABEL[active.provider] || PROVIDER_LABEL.unknown;
  const elapsed = formatElapsed(active.startedAt, now);
  const hasMultiple = pendingRequests.length > 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-primary-800/70 bg-primary-950/95 p-6 text-primary-100 shadow-2xl backdrop-blur"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-signature-modal-title"
      >
        <div className="flex items-start gap-4">
          <div className="mt-1 h-10 w-10 flex-shrink-0 rounded-full border border-accent-400/60 bg-accent-500/15 flex items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-300 border-t-transparent" />
          </div>
          <div className="min-w-0">
            <h2 id="wallet-signature-modal-title" className="text-lg font-semibold text-primary-50">
              Waiting For Wallet Signature
            </h2>
            <p className="mt-1 text-sm text-primary-200">
              Check your wallet and approve or reject the signature request to continue.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-primary-800/70 bg-primary-900/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2 text-primary-200">
            <span>{providerLabel}</span>
            <span className="font-mono text-xs text-primary-300">Waiting {elapsed}</span>
          </div>
          <p className="mt-2 break-words text-primary-100">{active.messagePreview}</p>
        </div>

        {hasMultiple && (
          <p className="mt-3 text-xs text-primary-300">
            {pendingRequests.length} signature requests are currently pending.
          </p>
        )}
      </div>
    </div>
  );
}
