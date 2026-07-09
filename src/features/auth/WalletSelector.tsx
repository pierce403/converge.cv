/**
 * Wallet selector component for onboarding
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useWalletConnection, type WalletOption } from '@/lib/wagmi';
import { WalletProviderSelector } from '@/components/WalletProviderSelector';
import { ThirdwebConnectButton } from '@/components/ThirdwebConnectButton';

interface WalletSelectorProps {
  onWalletConnected: (
    address: string,
    chainId?: number,
    signMessageOverride?: (message: string) => Promise<string>
  ) => void | Promise<void>;
  onBack: () => void;
  backLabel?: string;
  onImportKeyfile?: () => void;
}

export function WalletSelector({ onWalletConnected, onBack, backLabel, onImportKeyfile }: WalletSelectorProps) {
  const { connectWallet, address, chainId, isConnecting, walletOptions, provider } = useWalletConnection();
  const [error, setError] = useState<string | null>(null);
  const submittedConnectionRef = useRef<string | null>(null);

  const emitConnected = useCallback(
    async (
      nextAddress: string,
      nextChainId?: number,
      signMessageOverride?: (message: string) => Promise<string>
    ) => {
      const connectionKey = `${provider}:${nextAddress.trim().toLowerCase()}`;
      if (submittedConnectionRef.current === connectionKey) {
        return;
      }
      submittedConnectionRef.current = connectionKey;
      try {
        await onWalletConnected(nextAddress, nextChainId, signMessageOverride);
      } catch (error) {
        submittedConnectionRef.current = null;
        throw error;
      }
    },
    [onWalletConnected, provider]
  );

  const handleConnect = async (wallet: WalletOption) => {
    setError(null);
    try {
      // Let the connector own mobile deep links so its session can resume on return.
      const result = await connectWallet(wallet);
      if (result && result.accounts && result.accounts[0]) {
        await emitConnected(result.accounts[0], result.chainId);
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      
      // Handle common WalletConnect errors gracefully
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      if (errorMessage.includes('User rejected') || errorMessage.includes('User cancelled')) {
        setError('Connection cancelled. Please try again.');
      } else if (errorMessage.includes('session_request') || errorMessage.includes('listeners')) {
        setError('Connection timeout. Please try again.');
      } else {
        setError(errorMessage.includes('Failed') ? errorMessage : 'Failed to connect wallet');
      }
    }
  };

  // If already connected when component mounts, proceed once
  useEffect(() => {
    if (address) {
      void emitConnected(address, chainId).catch((err) => {
        console.error('Failed to continue after wallet connection:', err);
        setError(err instanceof Error ? err.message : 'Failed to continue with connected wallet');
      });
    }
  }, [address, chainId, emitConnected]);

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6 bg-primary-900/60 border border-primary-800/60 rounded-2xl shadow-lg backdrop-blur">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-primary-50">Approve with wallet</h2>
        <p className="text-primary-200">
          Choose a wallet that already controls the XMTP inbox
        </p>
      </div>

      <WalletProviderSelector dense />

      {error && (
        <div className="space-y-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <div>{error}</div>
          {address && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                void emitConnected(address, chainId).catch((retryError) => {
                  setError(
                    retryError instanceof Error
                      ? retryError.message
                      : 'Failed to continue with connected wallet'
                  );
                });
              }}
              className="rounded-md border border-red-400/50 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-900/50"
            >
              Retry wallet check
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {provider === 'thirdweb' ? (
          <ThirdwebConnectButton
            label="Continue with Thirdweb"
            className="w-full"
            onConnected={async (addr, nextChain, signMessageOverride) => {
              setError(null);
              try {
                await emitConnected(addr, nextChain, signMessageOverride);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Failed to continue with connected wallet'
                );
              }
            }}
          />
        ) : (
          walletOptions.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => handleConnect(wallet)}
              disabled={isConnecting || wallet.disabled}
              className="w-full p-4 bg-primary-950/60 hover:bg-primary-900 border border-primary-800/60 hover:border-accent-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{wallet.icon}</span>
                  <div className="text-left">
                    <div className="font-medium text-primary-50">{wallet.name}</div>
                    {wallet.description && (
                      <div className="text-xs text-primary-200">{wallet.description}</div>
                    )}
                  </div>
                </div>
                {isConnecting && (
                  <div className="animate-spin w-5 h-5 border-2 border-accent-400 border-t-transparent rounded-full" />
                )}
              </div>
            </button>
          ))
        )}

        {onImportKeyfile && (
          <button
            onClick={onImportKeyfile}
            className="w-full p-4 bg-primary-950/60 hover:bg-primary-900 border border-primary-800/60 hover:border-accent-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="font-medium text-primary-50">Restore from keyfile</div>
          </button>
        )}
      </div>

      <button
        onClick={onBack}
        className="w-full p-4 bg-primary-950/60 hover:bg-primary-900 border border-primary-800/60 hover:border-accent-400 rounded-lg font-medium transition-colors text-primary-100"
      >
        {backLabel ?? '← Back'}
      </button>

      <p className="text-xs text-primary-300 text-center">
        By connecting, you agree to the XMTP terms and our privacy policy
      </p>
    </div>
  );
}
