import { useMemo } from 'react';
import { useWalletProviderStore } from '@/lib/stores';
import { getWalletProviderAvailability, WALLET_PROVIDER_OPTIONS } from '@/lib/wallets/providers';
import { useWalletConnection } from '@/lib/wagmi';

interface WalletProviderSelectorProps {
  className?: string;
  dense?: boolean;
}

export function WalletProviderSelector({ className, dense }: WalletProviderSelectorProps) {
  const provider = useWalletProviderStore((state) => state.provider);
  const setProvider = useWalletProviderStore((state) => state.setProvider);
  const { disconnectWallet } = useWalletConnection();
  const availability = useMemo(() => getWalletProviderAvailability(), []);

  const handleSelect = async (nextProvider: typeof provider) => {
    if (nextProvider === provider) return;
    try {
      await disconnectWallet();
    } catch (error) {
      console.warn('[WalletProvider] Disconnect before switch failed:', error);
    }
    setProvider(nextProvider);
  };

  return (
    <div className={className}>
      <div className={`rounded-xl border border-primary-800/60 bg-primary-950/40 ${dense ? 'p-3' : 'p-4'}`}>
        <div className="text-sm font-medium text-primary-50">Wallet Provider</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {WALLET_PROVIDER_OPTIONS.map((option) => {
            const isAvailable = availability[option.id];
            const isActive = provider === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSelect(option.id)}
                disabled={!isAvailable}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  isActive
                    ? 'border-accent-400 bg-accent-500/20 text-accent-100'
                    : 'border-primary-800/60 bg-primary-950/40 text-primary-200 hover:border-accent-400/60'
                } ${!isAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-sm font-semibold">{option.label}</div>
                <div className="text-[11px] text-primary-300">{option.description}</div>
                {!isAvailable && option.id === 'privy' && (
                  <div className="mt-1 text-[10px] text-amber-300">
                    Set VITE_PRIVY_APP_ID to enable (client ID optional)
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
