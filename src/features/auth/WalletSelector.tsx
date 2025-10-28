/**
 * Wallet selector component for onboarding
 */

import { useState, useEffect, useRef } from 'react';
import { useWalletConnection, type WalletConnectorType } from '@/lib/wagmi';

interface WalletSelectorProps {
  onWalletConnected: (address: string, chainId?: number) => void;
  onBack: () => void;
}

export function WalletSelector({ onWalletConnected, onBack }: WalletSelectorProps) {
  const { connectWallet, address, chainId, isConnecting } = useWalletConnection();
  const [error, setError] = useState<string | null>(null);
  const hasTriggeredCallback = useRef(false);

  const wallets: Array<{ type: WalletConnectorType; name: string; icon: string }> = [
    { type: 'MetaMask', name: 'MetaMask', icon: '🦊' },
    { type: 'Coinbase Wallet', name: 'Coinbase Wallet', icon: '🔵' },
    { type: 'WalletConnect', name: 'WalletConnect', icon: '🔗' },
    { type: 'Injected', name: 'Browser Wallet', icon: '🌐' },
  ];

  const handleConnect = async (walletType: WalletConnectorType) => {
    setError(null);
    try {
      const result = await connectWallet(walletType);
      if (result && result.accounts && result.accounts[0]) {
        hasTriggeredCallback.current = true;
        onWalletConnected(result.accounts[0], result.chainId);
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  };

  // If already connected when component mounts, proceed once
  useEffect(() => {
    if (address && !hasTriggeredCallback.current) {
      hasTriggeredCallback.current = true;
      onWalletConnected(address, chainId);
    }
  }, [address, chainId, onWalletConnected]);

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
        <p className="text-slate-400">
          Choose a wallet to connect with XMTP
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {wallets.map((wallet) => (
          <button
            key={wallet.type}
            onClick={() => handleConnect(wallet.type)}
            disabled={isConnecting}
            className="w-full p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center justify-between transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{wallet.icon}</span>
              <span className="font-medium">{wallet.name}</span>
            </div>
            {isConnecting && (
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-700" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-slate-900 text-slate-400">or</span>
        </div>
      </div>

      <button
        onClick={onBack}
        className="w-full p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg font-medium transition-colors"
      >
        ← Generate Random Wallet
      </button>

      <p className="text-xs text-slate-500 text-center">
        By connecting, you agree to the XMTP terms and our privacy policy
      </p>
    </div>
  );
}

