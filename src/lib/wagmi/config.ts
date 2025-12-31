/**
 * Wagmi configuration for wallet connections
 */

import { http, createConfig as createWagmiConfig } from '@wagmi/core';
import { createConfig as createPrivyConfig } from '@privy-io/wagmi';
import { mainnet, base, baseSepolia } from '@wagmi/core/chains';
import { injected, metaMask, coinbaseWallet, walletConnect } from '@wagmi/connectors';
import { inAppWalletConnector } from '@thirdweb-dev/wagmi-adapter';
import { createThirdwebClient } from 'thirdweb';
import { resolveThirdwebClientId } from '@/lib/wallets/providers';

// WalletConnect/Reown project ID from https://cloud.reown.com/
const projectId = 'de49d3fcfa0a614710c571a3484a4d0f';

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
    showQrModal: true,
    qrModalOptions: {
      themeMode: 'dark',
    },
  }),
];

const thirdwebClientId = resolveThirdwebClientId();
const thirdwebClient = thirdwebClientId ? createThirdwebClient({ clientId: thirdwebClientId }) : null;
const thirdwebConnectors = thirdwebClient ? [inAppWalletConnector({ client: thirdwebClient })] : [];

export const wagmiConfigNative = createWagmiConfig({
  chains,
  connectors: nativeConnectors,
  transports,
});

export const wagmiConfigThirdweb = createWagmiConfig({
  chains,
  connectors: thirdwebConnectors.length > 0 ? thirdwebConnectors : nativeConnectors,
  transports,
});

export const wagmiConfigPrivy = createPrivyConfig({
  chains,
  transports,
});
