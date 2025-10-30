import { useState } from 'react';
import { useAuthStore } from '@/lib/stores';
import { QRCodeOverlay } from '@/components/QRCodeOverlay';

export function IdentityButton() {
  const identity = useAuthStore((s) => s.identity);
  const [showQR, setShowQR] = useState(false);

  if (!identity) return null;
  const letter = identity.displayName?.[0]?.toUpperCase() ?? identity.address[2]?.toUpperCase() ?? 'I';

  return (
    <>
      <button
        onClick={() => setShowQR(true)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-500 transition-colors border-2 border-primary-700 hover:border-primary-600 shadow-lg"
        title="Show QR Code"
      >
        {letter}
      </button>
      {showQR && <QRCodeOverlay address={identity.address} onClose={() => setShowQR(false)} />}
    </>
  );
}

