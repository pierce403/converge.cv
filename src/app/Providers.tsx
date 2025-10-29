import { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
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
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
