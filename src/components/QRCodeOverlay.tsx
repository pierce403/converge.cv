import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeOverlayProps {
  address: string;
  onClose: () => void;
}

export function QRCodeOverlay({ address, onClose }: QRCodeOverlayProps) {
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    const payload = `xmtp:ethereum:${address}`;
    QRCode.toDataURL(payload, { margin: 1, width: 300 }).then(setQr).catch(() => setQr(''));
  }, [address]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 p-2 text-white/80 hover:text-white transition-colors"
          title="Close"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* QR Code Card */}
        <div className="bg-white rounded-2xl p-6 shadow-2xl">
          {qr ? (
            <div className="space-y-4">
              <img src={qr} alt="Identity QR" className="w-72 h-72" />
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">Scan to message</p>
                <p className="text-xs text-gray-400 font-mono break-all">
                  {address.slice(0, 10)}...{address.slice(-8)}
                </p>
              </div>
            </div>
          ) : (
            <div className="w-72 h-72 flex items-center justify-center">
              <div className="text-gray-400">Generating QR code...</div>
            </div>
          )}
        </div>

        {/* Instruction */}
        <p className="text-center text-white/60 text-sm mt-4">
          Share this QR code for others to message you on XMTP
        </p>
      </div>
    </div>
  );
}

