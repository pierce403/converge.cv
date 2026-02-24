/**
 * Wallet connection hooks and provider bridge
 */
/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccount, useConnect, useDisconnect, useConnectors, useSignMessage } from 'wagmi';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';
import {
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useActiveWalletConnectionStatus,
  useConnectModal,
  useDisconnect as useThirdwebDisconnect,
} from 'thirdweb/react';
import { useWalletProviderStore } from '@/lib/stores';
import type { WalletProvider } from '@/lib/wallets/providers';
import { getThirdwebClient } from '@/lib/wallets/providers';
import { runWithWalletSignatureStatus } from '@/lib/wagmi/signature-status';

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description?: string;
  provider: WalletProvider;
  connectorId?: string;
  connectorName?: string;
  strategy?: string;
  disabled?: boolean;
}

export interface WalletConnectResult {
  accounts?: readonly string[];
  chainId?: number;
}

export interface WalletConnectionValue {
  provider: WalletProvider;
  setProvider: (provider: WalletProvider) => void;
  address?: string;
  chainId?: number;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  walletOptions: WalletOption[];
  connectWallet: (option: WalletOption) => Promise<WalletConnectResult | undefined>;
  connectDefaultWallet: () => Promise<WalletConnectResult | undefined>;
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
    provider: 'native',
    connectorName: 'Coinbase Wallet',
  },
  { id: 'metamask', name: 'MetaMask', icon: '🦊', provider: 'native', connectorName: 'MetaMask' },
  { id: 'walletconnect', name: 'WalletConnect', icon: '🔗', provider: 'native', connectorName: 'WalletConnect' },
  { id: 'injected', name: 'Browser Wallet', icon: '🌐', provider: 'native', connectorName: 'Injected' },
];

const thirdwebWalletOptions: WalletOption[] = [
  {
    id: 'thirdweb-email',
    name: 'Email',
    icon: '📧',
    description: 'Thirdweb in-app wallet',
    provider: 'thirdweb',
    connectorId: 'in-app-wallet',
    strategy: 'email',
  },
  {
    id: 'thirdweb-google',
    name: 'Google',
    icon: '🟢',
    description: 'Thirdweb in-app wallet',
    provider: 'thirdweb',
    connectorId: 'in-app-wallet',
    strategy: 'google',
  },
  {
    id: 'thirdweb-passkey',
    name: 'Passkey',
    icon: '🔐',
    description: 'Thirdweb in-app wallet',
    provider: 'thirdweb',
    connectorId: 'in-app-wallet',
    strategy: 'passkey',
  },
];

const privyWalletOptions = (ready: boolean, authenticated: boolean): WalletOption[] => [
  {
    id: 'privy',
    name: authenticated ? 'Connect another wallet' : 'Continue with Privy',
    icon: '🧩',
    description: authenticated ? 'Link another wallet via Privy' : 'Sign in or create a wallet with Privy',
    provider: 'privy',
    disabled: !ready,
  },
];

const resolveConnector = (
  option: WalletOption,
  connectors: ReturnType<typeof useConnectors>
) => {
  if (option.connectorId) {
    const byId = connectors.find((c) => c.id === option.connectorId);
    if (byId) return byId;
  }
  if (option.connectorName) {
    const byName = connectors.find((c) => c.name === option.connectorName);
    if (byName) return byName;
  }
  return connectors[0];
};

const normalizeAccounts = (accounts: unknown): readonly string[] | undefined => {
  if (!Array.isArray(accounts)) return undefined;
  if (accounts.length === 0) return [];
  const first = accounts[0] as unknown;
  if (typeof first === 'string') {
    return accounts.filter((item): item is string => typeof item === 'string');
  }
  if (typeof first === 'object' && first !== null && 'address' in (first as Record<string, unknown>)) {
    return accounts
      .map((item) => (typeof item === 'object' && item !== null ? (item as { address?: string }).address : undefined))
      .filter((address): address is string => typeof address === 'string');
  }
  return undefined;
};

const normalizeConnectResult = (result: { accounts?: unknown; chainId?: number } | undefined) => {
  if (!result) return undefined;
  return {
    accounts: normalizeAccounts(result.accounts),
    chainId: result.chainId,
  } satisfies WalletConnectResult;
};

function WagmiWalletConnectionProvider({
  children,
  provider,
}: {
  children: ReactNode;
  provider: Exclude<WalletProvider, 'privy'>;
}) {
  const account = useAccount();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const connectors = useConnectors();
  const { signMessageAsync } = useSignMessage();
  const { setProvider } = useWalletProviderStore();
  const isMobile = isMobileDevice();
  const hasThirdwebConnector = useMemo(
    () => connectors.some((connector) => connector.id === 'in-app-wallet'),
    [connectors]
  );

  const walletOptions = useMemo(() => {
    if (provider === 'thirdweb' && hasThirdwebConnector) {
      return thirdwebWalletOptions;
    }
    return nativeWalletOptions(isMobile);
  }, [provider, hasThirdwebConnector, isMobile]);

  const connectWallet = useCallback(
    async (option: WalletOption) => {
      const connector = resolveConnector(option, connectors);
      if (!connector) {
        throw new Error('No wallet connectors are available.');
      }
      const params: Record<string, unknown> = { connector };
      if (option.strategy) {
        params.strategy = option.strategy;
      }
      const result = await connectAsync(params as Parameters<typeof connectAsync>[0]);
      return normalizeConnectResult(result);
    },
    [connectAsync, connectors]
  );

  const connectDefaultWallet = useCallback(async () => {
    const primary = walletOptions[0];
    if (primary) {
      return await connectWallet(primary);
    }
    const connector = connectors[0];
    if (!connector) {
      throw new Error('No wallet connectors are available.');
    }
    const result = await connectAsync({ connector });
    return normalizeConnectResult(result);
  }, [walletOptions, connectWallet, connectAsync, connectors]);

  const disconnectWallet = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const signMessage = useCallback(
    async (message: string, accountAddress?: string) =>
      await runWithWalletSignatureStatus({
        provider,
        message,
        run: async () =>
          await signMessageAsync({
            message,
            account: accountAddress as `0x${string}` | undefined,
          }),
      }),
    [provider, signMessageAsync]
  );

  const value = useMemo<WalletConnectionValue>(
    () => ({
      provider,
      setProvider,
      address: account.address,
      chainId: account.chainId,
      isConnected: Boolean(account.address),
      isConnecting,
      isDisconnecting,
      walletOptions,
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    }),
    [
      provider,
      setProvider,
      account.address,
      account.chainId,
      isConnecting,
      isDisconnecting,
      walletOptions,
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    ]
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}

function PrivyWalletConnectionProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { ready, authenticated, login, logout, connectWallet: connectPrivyWallet } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { setProvider } = useWalletProviderStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const walletsRef = useRef(wallets);

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  const walletOptions = useMemo(() => privyWalletOptions(ready, authenticated), [ready, authenticated]);

  const pickWallet = useCallback(() => {
    const candidates = (walletsRef.current ?? []) as ConnectedWallet[];
    const withAddress = candidates.filter((wallet) => Boolean(wallet.address));
    return withAddress[withAddress.length - 1];
  }, []);

  const waitForWallet = useCallback(async () => {
    const timeoutMs = 6000;
    const intervalMs = 200;
    const start = Date.now();
    let current = pickWallet();
    while (!current?.address && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      current = pickWallet();
    }
    return current;
  }, [pickWallet]);

  const connectWallet = useCallback(
    async (_option: WalletOption) => {
      setIsConnecting(true);
      try {
        if (!ready) {
          throw new Error('Privy is still loading. Please try again.');
        }
        if (!authenticated) {
          await login();
        } else {
          await connectPrivyWallet();
        }
        const wallet = await waitForWallet();
        if (wallet) {
          await setActiveWallet(wallet);
        }
        const chainIdValue =
          typeof wallet?.chainId === 'number'
            ? wallet.chainId
            : typeof wallet?.chainId === 'string'
              ? Number(wallet.chainId.split(':').pop())
              : undefined;
        return wallet?.address
          ? { accounts: [wallet.address], chainId: Number.isFinite(chainIdValue) ? chainIdValue : undefined }
          : undefined;
      } finally {
        setIsConnecting(false);
      }
    },
    [ready, authenticated, login, connectPrivyWallet, waitForWallet, setActiveWallet]
  );

  const connectDefaultWallet = useCallback(async () => {
    const primary = walletOptions[0];
    if (primary) {
      return await connectWallet(primary);
    }
    return undefined;
  }, [walletOptions, connectWallet]);

  const disconnectWallet = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      if (authenticated) {
        await logout();
      }
      await disconnectAsync();
    } finally {
      setIsDisconnecting(false);
    }
  }, [authenticated, logout, disconnectAsync]);

  const signMessage = useCallback(
    async (message: string, accountAddress?: string) =>
      await runWithWalletSignatureStatus({
        provider: 'privy',
        message,
        run: async () =>
          await signMessageAsync({
            message,
            account: accountAddress as `0x${string}` | undefined,
          }),
      }),
    [signMessageAsync]
  );

  const value = useMemo<WalletConnectionValue>(
    () => ({
      provider: 'privy',
      setProvider,
      address: account.address,
      chainId: account.chainId,
      isConnected: Boolean(account.address),
      isConnecting,
      isDisconnecting,
      walletOptions,
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    }),
    [
      setProvider,
      account.address,
      account.chainId,
      isConnecting,
      isDisconnecting,
      walletOptions,
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    ]
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}

function ThirdwebWalletConnectionProvider({ children }: { children: ReactNode }) {
  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();
  const activeChain = useActiveWalletChain();
  const connectionStatus = useActiveWalletConnectionStatus();
  const { disconnect } = useThirdwebDisconnect();
  const { connect, isConnecting } = useConnectModal();
  const { setProvider } = useWalletProviderStore();

  const connectViaModal = useCallback(async () => {
    const client = getThirdwebClient();
    if (!client) {
      throw new Error('Thirdweb client ID is not configured.');
    }
    const wallet = await connect({
      client,
      theme: 'dark',
      size: 'compact',
      title: 'Connect with Thirdweb',
    });
    const account = wallet.getAccount();
    return {
      accounts: account?.address ? [account.address] : undefined,
      chainId: wallet.getChain()?.id,
    } satisfies WalletConnectResult;
  }, [connect]);

  const connectWallet = useCallback(async (_option: WalletOption) => await connectViaModal(), [connectViaModal]);
  const connectDefaultWallet = useCallback(async () => await connectViaModal(), [connectViaModal]);

  const disconnectWallet = useCallback(async () => {
    if (activeWallet) {
      await disconnect(activeWallet);
    }
  }, [activeWallet, disconnect]);

  const signMessage = useCallback(
    async (message: string) => {
      if (!activeAccount) {
        throw new Error('No Thirdweb account is connected.');
      }
      return await runWithWalletSignatureStatus({
        provider: 'thirdweb',
        message,
        run: async () => await activeAccount.signMessage({ message }),
      });
    },
    [activeAccount]
  );

  const value = useMemo<WalletConnectionValue>(
    () => ({
      provider: 'thirdweb',
      setProvider,
      address: activeAccount?.address,
      chainId: activeChain?.id,
      isConnected: Boolean(activeAccount?.address),
      isConnecting: connectionStatus === 'connecting' || isConnecting,
      isDisconnecting: false,
      walletOptions: [],
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    }),
    [
      setProvider,
      activeAccount?.address,
      activeChain?.id,
      connectionStatus,
      isConnecting,
      connectWallet,
      connectDefaultWallet,
      disconnectWallet,
      signMessage,
    ]
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}

export function WalletConnectionProvider({
  children,
  providerOverride,
}: {
  children: ReactNode;
  providerOverride?: WalletProvider;
}) {
  const storedProvider = useWalletProviderStore((state) => state.provider);
  const provider = providerOverride ?? storedProvider;

  if (provider === 'privy') {
    return <PrivyWalletConnectionProvider>{children}</PrivyWalletConnectionProvider>;
  }

  if (provider === 'thirdweb') {
    return <ThirdwebWalletConnectionProvider>{children}</ThirdwebWalletConnectionProvider>;
  }

  return (
    <WagmiWalletConnectionProvider provider={provider}>
      {children}
    </WagmiWalletConnectionProvider>
  );
}

export function useWalletConnection() {
  const context = useContext(WalletConnectionContext);
  if (!context) {
    throw new Error('useWalletConnection must be used within WalletConnectionProvider');
  }
  return context;
}
