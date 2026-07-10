/**
 * Wallet selector component for onboarding
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useWalletConnection, type WalletOption } from '@/lib/wagmi';
import { formatWalletConnectionError } from './wallet-connection-error';
import { normalizeEthereumAddress, requireEthereumAddress } from '@/lib/utils/ethereum';
import {
  isWalletInspectionRequiredError,
  type WalletTypeHint,
} from '@/lib/wagmi/wallet-inspection';

interface WalletSelectorProps {
  onWalletConnected: (
    address: string,
    chainId?: number,
    signMessageOverride?: (message: string) => Promise<string>,
    walletTypeHint?: WalletTypeHint
  ) => void | Promise<void>;
  onBack: () => void;
  backLabel?: string;
  onImportKeyfile?: () => void;
}

export function WalletSelector({ onWalletConnected, onBack, backLabel, onImportKeyfile }: WalletSelectorProps) {
  const {
    connectWallet,
    address,
    chainId,
    isConnecting,
    walletOptions,
    signMessage,
  } = useWalletConnection();
  const [error, setError] = useState<string | null>(null);
  const chainIdRef = useRef(chainId);
  const connectorStartAddressRef = useRef<string | null>(null);
  const [connectorPending, setConnectorPending] = useState(false);
  const [inspectionFallback, setInspectionFallback] = useState<{
    address: string;
    chainId?: number;
    signMessage?: (message: string) => Promise<string>;
  } | null>(null);
  const submittedConnectionRef = useRef<{
    key: string;
    hasSigner: boolean;
    promise: Promise<void>;
  } | null>(null);

  const emitConnected = useCallback(
    async (
      nextAddress: string,
      nextChainId?: number,
      signMessageOverride?: (message: string) => Promise<string>,
      walletTypeHint?: WalletTypeHint
    ) => {
      const canonicalAddress = requireEthereumAddress(nextAddress, 'Connected wallet address');
      const connectionKey = `native:${canonicalAddress}:${walletTypeHint ?? 'inspect'}`;
      const existing = submittedConnectionRef.current;
      if (existing?.key === connectionKey) {
        if (existing.hasSigner || !signMessageOverride) {
          await existing.promise;
          return;
        }
        // A provider state effect may arrive just before the connector returns
        // its account-bound signer. Let that attempt settle, then upgrade it.
        try {
          await existing.promise;
        } catch {
          // The richer connector result below is the recovery attempt.
        }
      }
      const promise = Promise.resolve(
        walletTypeHint
          ? onWalletConnected(
              canonicalAddress,
              nextChainId,
              signMessageOverride,
              walletTypeHint
            )
          : onWalletConnected(canonicalAddress, nextChainId, signMessageOverride)
      ).then(() => undefined);
      submittedConnectionRef.current = {
        key: connectionKey,
        hasSigner: Boolean(signMessageOverride),
        promise,
      };
      try {
        await promise;
        setInspectionFallback(null);
      } catch (error) {
        if (isWalletInspectionRequiredError(error)) {
          setInspectionFallback({
            address: canonicalAddress,
            chainId: nextChainId,
            signMessage: signMessageOverride,
          });
        }
        if (submittedConnectionRef.current?.promise === promise) {
          submittedConnectionRef.current = null;
        }
        throw error;
      }
    },
    [onWalletConnected]
  );

  const handleConnect = async (wallet: WalletOption) => {
    setError(null);
    setInspectionFallback(null);
    connectorStartAddressRef.current = normalizeEthereumAddress(address);
    setConnectorPending(true);
    try {
      // Let the connector own mobile deep links so its session can resume on return.
      const result = await connectWallet(wallet);
      if (result && result.accounts && result.accounts[0]) {
        await emitConnected(
          result.accounts[0],
          result.chainId ?? chainIdRef.current,
          result.signMessage
        );
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(formatWalletConnectionError(err));
    } finally {
      connectorStartAddressRef.current = null;
      setConnectorPending(false);
    }
  };

  useEffect(() => {
    chainIdRef.current = chainId;
  }, [chainId]);

  // If already connected when component mounts, proceed once
  useEffect(() => {
    const canonicalAddress = normalizeEthereumAddress(address);
    const providerAdvancedDuringConnect = Boolean(
      connectorPending &&
      canonicalAddress &&
      canonicalAddress !== connectorStartAddressRef.current &&
      signMessage
    );
    if (
      canonicalAddress &&
      !inspectionFallback &&
      ((!connectorPending && !isConnecting) || providerAdvancedDuringConnect)
    ) {
      const accountSigner = signMessage
        ? async (message: string) => await signMessage(message, canonicalAddress)
        : undefined;
      void emitConnected(canonicalAddress, chainId, accountSigner).catch((err) => {
        console.error('Failed to continue after wallet connection:', err);
        setError(err instanceof Error ? err.message : 'Failed to continue with connected wallet');
      });
    }
  }, [
    address,
    chainId,
    connectorPending,
    emitConnected,
    inspectionFallback,
    isConnecting,
    signMessage,
  ]);

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6 bg-primary-900/60 border border-primary-800/60 rounded-2xl shadow-lg backdrop-blur">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-primary-50">Approve with wallet</h2>
        <p className="text-primary-200">
          Choose a wallet that already controls the XMTP inbox
        </p>
      </div>

      {error && (
        <div className="space-y-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <div>{error}</div>
          {inspectionFallback ? (
            <div className="space-y-2">
              <div className="text-red-100">What kind of wallet is this?</div>
              <div className="text-xs text-red-200/90">
                Converge could not inspect the account, so choose its wallet type to continue.
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    void emitConnected(
                      inspectionFallback.address,
                      inspectionFallback.chainId,
                      inspectionFallback.signMessage,
                      'EOA'
                    ).catch((fallbackError) => {
                      setError(
                        fallbackError instanceof Error
                          ? fallbackError.message
                          : 'Failed to continue with connected wallet'
                      );
                    });
                  }}
                  className="rounded-md border border-red-400/50 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-900/50"
                >
                  Regular wallet
                </button>
                <button
                  type="button"
                  disabled={
                    !Number.isSafeInteger(inspectionFallback.chainId) ||
                    (inspectionFallback.chainId ?? 0) <= 0
                  }
                  onClick={() => {
                    setError(null);
                    void emitConnected(
                      inspectionFallback.address,
                      inspectionFallback.chainId,
                      inspectionFallback.signMessage,
                      'SCW'
                    ).catch((fallbackError) => {
                      setError(
                        fallbackError instanceof Error
                          ? fallbackError.message
                          : 'Failed to continue with connected wallet'
                      );
                    });
                  }}
                  className="rounded-md border border-red-400/50 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    !Number.isSafeInteger(inspectionFallback.chainId) ||
                    (inspectionFallback.chainId ?? 0) <= 0
                      ? 'Reconnect the smart account on its network first.'
                      : undefined
                  }
                >
                  Smart account (such as Base app)
                </button>
              </div>
            </div>
          ) : address ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                const accountSigner = signMessage
                  ? async (message: string) => await signMessage(message, address)
                  : undefined;
                void emitConnected(address, chainId, accountSigner).catch((retryError) => {
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
          ) : null}
        </div>
      )}

      <div className="space-y-3">
        {walletOptions.map((wallet) => (
          <button
            key={wallet.id}
            onClick={() => handleConnect(wallet)}
            disabled={isConnecting || connectorPending || wallet.disabled}
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
        ))}

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
