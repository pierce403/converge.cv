/**
 * Wagmi configuration for wallet connections
 */

import { http, createConfig as createWagmiConfig } from '@wagmi/core';
import { mainnet, base, baseSepolia } from '@wagmi/core/chains';
import { injected, metaMask, coinbaseWallet, walletConnect } from '@wagmi/connectors';

// WalletConnect/Reown project ID from https://cloud.reown.com/
const projectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  'de49d3fcfa0a614710c571a3484a4d0f';

const chains = [mainnet, base, baseSepolia] as const;
const transports = {
  [mainnet.id]: http(),
  [base.id]: http(),
  [baseSepolia.id]: http(),
};

const nativeConnectors = [
  injected(),
  metaMask(),
  coinbaseWallet({
    appName: 'Converge',
    preference: { options: 'all', telemetry: false }, // Support both EOA and smart wallets; disable Coinbase telemetry
  }),
  walletConnect({
    projectId,
    metadata: {
      name: 'Converge',
      description: 'Private messaging over XMTP',
      url: 'https://converge.cv',
      icons: ['https://converge.cv/icons/icon-192.png'],
    },
    showQrModal: true,
    qrModalOptions: {
      themeMode: 'dark',
    },
  }),
];

export const wagmiConfigNative = createWagmiConfig({
  chains,
  connectors: nativeConnectors,
  transports,
});
