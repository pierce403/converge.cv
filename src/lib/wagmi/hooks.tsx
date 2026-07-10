/**
 * Native Wagmi wallet connection hooks.
 */
/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSignMessage,
} from 'wagmi';
import { runWithWalletSignatureStatus } from '@/lib/wagmi/signature-status';
import { normalizeWalletAccounts } from '@/lib/wagmi/wallet-account';
import { ethereumAddressesEqual } from '@/lib/utils/ethereum';
import { resolveWalletConnector } from '@/lib/wagmi/wallet-connector';

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description?: string;
  connectorId?: string;
  connectorName?: string;
  disabled?: boolean;
}

export interface WalletConnectResult {
  accounts?: readonly string[];
  chainId?: number;
  signMessage?: (message: string) => Promise<string>;
}

export interface WalletConnectionValue {
  address?: string;
  chainId?: number;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  walletOptions: WalletOption[];
  connectWallet: (option: WalletOption) => Promise<WalletConnectResult | undefined>;
  disconnectWallet: () => Promise<void>;
  signMessage?: (message: string, accountAddress?: string) => Promise<string>;
}

const WalletConnectionContext = createContext<WalletConnectionValue | null>(null);

const isMobileDevice = () =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const nativeWalletOptions = (isMobile: boolean): WalletOption[] => [
  {
    id: 'coinbase',
    name: isMobile ? 'Base Wallet' : 'Coinbase Wallet',
    icon: '🔵',
    description: isMobile ? 'Opens Base app' : undefined,
    connectorName: 'Coinbase Wallet',
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: '🦊',
    connectorName: 'MetaMask',
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: '🔗',
    connectorName: 'WalletConnect',
  },
  {
    id: 'injected',
    name: 'Browser Wallet',
    icon: '🌐',
    connectorName: 'Injected',
  },
];

const normalizeConnectResult = (result: { accounts?: unknown; chainId?: number } | undefined) => {
  if (!result) return undefined;
  return {
    accounts: normalizeWalletAccounts(result.accounts),
    chainId: result.chainId,
  } satisfies WalletConnectResult;
};

function NativeWalletConnectionProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const connectors = useConnectors();
  const { signMessageAsync } = useSignMessage();
  const walletOptions = useMemo(
    () => nativeWalletOptions(isMobileDevice()),
    []
  );

  const signMessageForAccount = useCallback(
    async (message: string, accountAddress: string) =>
      await runWithWalletSignatureStatus({
        provider: 'native',
        message,
        run: async () =>
          await signMessageAsync({
            message,
            account: accountAddress as `0x${string}`,
          }),
      }),
    [signMessageAsync]
  );

  const connectWallet = useCallback(
    async (option: WalletOption) => {
      const connector = resolveWalletConnector(option, connectors);
      if (!connector) {
        throw new Error(`${option.name} is not available in this browser. Choose another wallet.`);
      }
      const result = await connectAsync({ connector });
      const normalized = normalizeConnectResult(result);
      const connectedAddress = normalized?.accounts?.[0];
      return normalized && connectedAddress
        ? {
            ...normalized,
            signMessage: async (message: string) =>
              await signMessageForAccount(message, connectedAddress),
          }
        : normalized;
    },
    [connectAsync, connectors, signMessageForAccount]
  );

  const disconnectWallet = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const signMessage = useCallback(
    async (message: string, accountAddress?: string) => {
      if (accountAddress && !ethereumAddressesEqual(account.address, accountAddress)) {
        throw new Error('The selected wallet account is no longer active. Reconnect it and retry.');
      }
      const selectedAddress = accountAddress ?? account.address;
      if (!selectedAddress) {
        throw new Error('No wallet account is connected.');
      }
      return await signMessageForAccount(message, selectedAddress);
    },
    [account.address, signMessageForAccount]
  );

  const value = useMemo<WalletConnectionValue>(
    () => ({
      address: account.address,
      chainId: account.chainId,
      isConnected: Boolean(account.address),
      isConnecting,
      isDisconnecting,
      walletOptions,
      connectWallet,
      disconnectWallet,
      signMessage,
    }),
    [
      account.address,
      account.chainId,
      connectWallet,
      disconnectWallet,
      isConnecting,
      isDisconnecting,
      signMessage,
      walletOptions,
    ]
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}

export function WalletConnectionProvider({ children }: { children: ReactNode }) {
  return <NativeWalletConnectionProvider>{children}</NativeWalletConnectionProvider>;
}

export function useWalletConnection() {
  const context = useContext(WalletConnectionContext);
  if (!context) {
    throw new Error('useWalletConnection must be used within WalletConnectionProvider');
  }
  return context;
}
