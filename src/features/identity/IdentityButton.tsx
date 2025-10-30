import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import { formatMessageTime } from '@/lib/utils/date';
import QRCode from 'qrcode';

function truncate(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function IdentityButton() {
  const identity = useAuthStore((s) => s.identity);
  const [open, setOpen] = useState(false);

  if (!identity) return null;
  const letter = identity.displayName?.[0]?.toUpperCase() ?? identity.address[2]?.toUpperCase() ?? 'I';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-500 transition-colors border-2 border-primary-700 hover:border-primary-600 shadow-lg"
        title={`Identity: ${truncate(identity.address)}`}
      >
        {letter}
      </button>
      {open && <IdentityModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-sm">
      <div className="text-primary-300 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-primary-900/50 px-2 py-1 text-primary-100 border border-primary-800/60">{value}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded border border-primary-800/60 px-2 py-1 text-xs text-primary-100 hover:border-primary-700"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function IdentityModal({ onClose }: { onClose: () => void }) {
  const identity = useAuthStore((s) => s.identity)!;
  const [inboxId, setInboxId] = useState<string>('');
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    try {
      const xmtp = getXmtpClient();
      setInboxId(xmtp.getInboxId() ?? '');
    } catch {
      setInboxId('');
    }
  }, []);

  useEffect(() => {
    const payload = `xmtp:ethereum:${identity.address}`;
    QRCode.toDataURL(payload, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
  }, [identity.address]);

  const letter = identity.displayName?.[0]?.toUpperCase() ?? identity.address[2]?.toUpperCase() ?? 'I';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-20">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-primary-800/60 bg-primary-950 p-4 shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-primary-100">Identity Information</h3>
          <button onClick={onClose} className="rounded p-1 text-primary-300 hover:text-primary-100" title="Close">
            ✕
          </button>
        </div>
        
        <div className="space-y-3">
          {/* Avatar/Display Name Section */}
          <div className="flex flex-col items-center gap-2 pb-3 border-b border-primary-800/60">
            {identity.avatar ? (
              <img src={identity.avatar} alt="Avatar" className="h-12 w-12 rounded-full" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-600 text-white text-xl font-semibold">
                {letter}
              </div>
            )}
            {identity.displayName ? (
              <div>
                <div className="text-center font-semibold text-primary-100">{identity.displayName}</div>
                <div className="text-center text-sm text-primary-300">{truncate(identity.address)}</div>
              </div>
            ) : (
              <div className="text-center text-sm text-primary-300">{truncate(identity.address)}</div>
            )}
          </div>

          {/* Identity Details */}
          <div className="space-y-2">
            <CopyField label="Ethereum Address" value={identity.address} />
            {identity.displayName && (
              <div className="text-sm">
                <div className="text-primary-300 mb-1">Display Name</div>
                <div className="text-primary-100">{identity.displayName}</div>
              </div>
            )}
            {inboxId && <CopyField label="XMTP Inbox ID" value={inboxId} />}
            {identity.installationId && (
              <CopyField label="Installation ID" value={identity.installationId} />
            )}
            {identity.createdAt && (
              <div className="text-sm">
                <div className="text-primary-300 mb-1">Created</div>
                <div className="text-primary-100">{formatMessageTime(identity.createdAt)}</div>
              </div>
            )}
          </div>

          {/* QR Code Section */}
          <div className="pt-3 border-t border-primary-800/60">
            <div className="mb-2 text-sm text-primary-300">Share QR Code</div>
            {qr ? (
              <img src={qr} alt="Identity QR" className="mx-auto h-48 w-48 rounded bg-white p-2" />
            ) : (
              <div className="h-48 w-48 mx-auto flex items-center justify-center text-primary-300 rounded bg-primary-900/30">
                Generating…
              </div>
            )}
            <p className="mt-2 text-xs text-primary-300 text-center">
              Scan to message: xmtp:ethereum:{identity.address.slice(0, 10)}…
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

