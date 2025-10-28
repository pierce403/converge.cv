/**
 * Wagmi configuration for wallet connections
 */

import { http, createConfig } from '@wagmi/core';
import { mainnet, base, baseSepolia } from '@wagmi/core/chains';
import { injected, metaMask, coinbaseWallet, walletConnect } from '@wagmi/connectors';

// WalletConnect/Reown project ID from https://cloud.reown.com/
const projectId = 'de49d3fcfa0a614710c571a3484a4d0f';

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

