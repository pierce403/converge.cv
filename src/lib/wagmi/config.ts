/**
 * Wagmi configuration for wallet connections
 */

import { http, createConfig } from '@wagmi/core';
import { mainnet, base, baseSepolia } from '@wagmi/core/chains';
import { injected, metaMask, coinbaseWallet, walletConnect } from '@wagmi/connectors';

// Get WalletConnect project ID from environment or use a default
const projectId = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID || 'converge-cv-default';

export const wagmiConfig = createConfig({
  chains: [mainnet, base, baseSepolia],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'Converge' }),
    walletConnect({ projectId }),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});

