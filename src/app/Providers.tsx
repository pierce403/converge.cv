import { ReactNode, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi';
import { PrivyProvider } from '@privy-io/react-auth';
import { ThirdwebProvider } from 'thirdweb/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletConnectionProvider, wagmiConfigNative, wagmiConfigPrivy } from '@/lib/wagmi';
import { useWalletProviderStore } from '@/lib/stores';
import { resolvePrivyAppId } from '@/lib/wallets/providers';
// Initialize the worker tracker early so we capture workers created during app bootstrap
import '@/lib/debug/worker-tracker';

const queryClient = new QueryClient();

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * AppProviders wraps the app with all necessary context providers
 * (Auth, Storage, XMTP, etc.)
 */
export function AppProviders({ children }: AppProvidersProps) {
  const provider = useWalletProviderStore((state) => state.provider);
  const setProvider = useWalletProviderStore((state) => state.setProvider);
  const privyAppId = resolvePrivyAppId();
  const privyAvailable = Boolean(privyAppId);
  const effectiveProvider = provider === 'privy' && privyAvailable ? 'privy' : provider === 'privy' ? 'thirdweb' : provider;

  useEffect(() => {
    if (provider === 'privy' && !privyAvailable) {
      console.warn('[WalletProvider] Privy app ID missing; falling back to thirdweb.');
      setProvider('thirdweb');
    }
  }, [provider, privyAvailable, setProvider]);

  if (effectiveProvider === 'privy' && privyAppId) {
    return (
      <PrivyProvider appId={privyAppId}>
        <PrivyWagmiProvider config={wagmiConfigPrivy}>
          <QueryClientProvider client={queryClient}>
            <WalletConnectionProvider providerOverride="privy">
              {children}
            </WalletConnectionProvider>
          </QueryClientProvider>
        </PrivyWagmiProvider>
      </PrivyProvider>
    );
  }
  
  if (effectiveProvider === 'thirdweb') {
    return (
      <ThirdwebProvider>
        <WagmiProvider config={wagmiConfigNative}>
          <QueryClientProvider client={queryClient}>
            <WalletConnectionProvider providerOverride="thirdweb">
              {children}
            </WalletConnectionProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </ThirdwebProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfigNative}>
      <QueryClientProvider client={queryClient}>
        <WalletConnectionProvider providerOverride={effectiveProvider}>
          {children}
        </WalletConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
