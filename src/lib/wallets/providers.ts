export type WalletProvider = 'native' | 'thirdweb' | 'privy';

export const DEFAULT_WALLET_PROVIDER: WalletProvider = 'thirdweb';

const THIRDWEB_CLIENT_ID_FALLBACK = 'eb8bec9287101b98c08a3150aed11218';

export const resolveThirdwebClientId = (): string | undefined => {
  const metaKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_THIRDWEB_CLIENT_ID : undefined;
  if (metaKey) return metaKey;
  if (typeof process !== 'undefined') {
    const envKey = (process.env as Record<string, string | undefined>)?.VITE_THIRDWEB_CLIENT_ID;
    if (envKey) return envKey;
  }
  return THIRDWEB_CLIENT_ID_FALLBACK;
};

export const resolvePrivyAppId = (): string | undefined => {
  const metaKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PRIVY_APP_ID : undefined;
  if (metaKey) return metaKey;
  if (typeof process !== 'undefined') {
    const envKey = (process.env as Record<string, string | undefined>)?.VITE_PRIVY_APP_ID;
    if (envKey) return envKey;
  }
  return undefined;
};

export const WALLET_PROVIDER_OPTIONS: Array<{
  id: WalletProvider;
  label: string;
  description: string;
}> = [
  {
    id: 'native',
    label: 'Native',
    description: 'MetaMask, Coinbase, WalletConnect, or injected wallets',
  },
  {
    id: 'thirdweb',
    label: 'Thirdweb',
    description: 'Thirdweb in-app wallets (email, social, passkey)',
  },
  {
    id: 'privy',
    label: 'Privy',
    description: 'Privy embedded + external wallets',
  },
];

export const getWalletProviderAvailability = (): Record<WalletProvider, boolean> => ({
  native: true,
  thirdweb: Boolean(resolveThirdwebClientId()),
  privy: Boolean(resolvePrivyAppId()),
});
