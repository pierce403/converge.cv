/**
 * Wagmi configuration for wallet connections
 */

import { http, createConfig } from '@wagmi/core';
import { mainnet, base, baseSepolia } from '@wagmi/core/chains';
import { injected, metaMask, coinbaseWallet, walletConnect } from '@wagmi/connectors';

// Get WalletConnect project ID - using a default for now
// In production, you can set VITE_WALLETCONNECT_PROJECT_ID in .env
const projectId = 'converge-cv-default';

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

