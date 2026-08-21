/**
 * Native Wagmi wallet connection hooks.
 */
/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { signMessage as signMessageWithConnector, type Connector } from '@wagmi/core';
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
import { wagmiConfigNative } from '@/lib/wagmi/config';
import {
  clearWalletConnectionIntent,
  createWalletConnectionIntent,
  persistWalletConnectionIntent,
  readWalletConnectionIntent,
  WALLET_CONNECTION_INTENT_STORAGE_KEY,
  type WalletConnectionFlow,
  type WalletConnectionIntent,
} from '@/lib/wagmi/wallet-connection-intent';

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

export interface WalletConnectRequest {
  flow?: WalletConnectionFlow;
}

export interface WalletConnectionValue {
  address?: string;
  chainId?: number;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  walletOptions: WalletOption[];
  pendingWalletConnection: WalletConnectionIntent | null;
  connectWallet: (
    option: WalletOption,
    request?: WalletConnectRequest
  ) => Promise<WalletConnectResult | undefined>;
  resumeWalletConnection: (
    flow?: WalletConnectionFlow
  ) => Promise<WalletConnectResult | undefined>;
  clearPendingWalletConnection: () => void;
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
    connectorId: 'coinbaseWalletSDK',
    connectorName: 'Coinbase Wallet',
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: '🦊',
    description: isMobile ? 'Uses WalletConnect for a reliable app return' : undefined,
    connectorId: isMobile ? 'walletConnect' : 'metaMaskSDK',
    connectorName: 'MetaMask',
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: '🔗',
    connectorId: 'walletConnect',
    connectorName: 'WalletConnect',
  },
  {
    id: 'injected',
    name: 'Browser Wallet',
    icon: '🌐',
    connectorId: 'injected',
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

const walletReturnProbeDelays = [0, 250, 750, 1_500, 2_500] as const;
const walletProbeTimeoutMs = 2_000;

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

async function withWalletProbeTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Wallet session probe timed out.')),
          walletProbeTimeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function probeWalletConnector(
  connector: Connector
): Promise<WalletConnectResult | undefined> {
  try {
    const accounts = normalizeWalletAccounts(
      await withWalletProbeTimeout(connector.getAccounts())
    );
    if (!accounts[0]) return undefined;
    const chainId = await withWalletProbeTimeout(connector.getChainId()).catch(
      () => undefined
    );
    return { accounts, chainId };
  } catch {
    return undefined;
  }
}

function isWalletConnectionCancellation(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 4001) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user cancelled') ||
    message.includes('user canceled')
  );
}

function waitForWalletConnectorReturn(connector: Connector): {
  promise: Promise<WalletConnectResult>;
  cleanup: () => void;
} {
  let finished = false;
  let resolveRecovered: (result: WalletConnectResult) => void = () => undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const promise = new Promise<WalletConnectResult>((resolve) => {
    resolveRecovered = resolve;
  });

  const recover = (result: WalletConnectResult | undefined) => {
    if (finished || !result?.accounts?.[0]) return;
    finished = true;
    resolveRecovered(result);
  };

  const probe = () => {
    void probeWalletConnector(connector).then(recover);
  };

  const scheduleProbes = () => {
    if (finished) return;
    for (const timer of timers) clearTimeout(timer);
    timers = walletReturnProbeDelays.map((delayMs) => setTimeout(probe, delayMs));
  };

  const onConnect = (event: { accounts: readonly `0x${string}`[]; chainId: number }) => {
    recover(normalizeConnectResult(event));
  };
  const onChange = (event: {
    accounts?: readonly `0x${string}`[];
    chainId?: number;
  }) => {
    if (event.accounts?.[0]) recover(normalizeConnectResult(event));
  };
  const onPageShow = () => scheduleProbes();
  const onFocus = () => scheduleProbes();
  const onVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      scheduleProbes();
    }
  };

  connector.emitter.on('connect', onConnect);
  connector.emitter.on('change', onChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  scheduleProbes();

  return {
    promise,
    cleanup: () => {
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      connector.emitter.off('connect', onConnect);
      connector.emitter.off('change', onChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}

function NativeWalletConnectionProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const connectors = useConnectors();
  const { signMessageAsync } = useSignMessage();
  const [pendingWalletConnection, setPendingWalletConnection] =
    useState<WalletConnectionIntent | null>(() => readWalletConnectionIntent());
  const resumePromiseRef = useRef<{
    attemptId: string;
    promise: Promise<WalletConnectResult | undefined>;
  } | null>(null);
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

  const createConnectorBoundSigner = useCallback(
    (connector: Connector, accountAddress: string) =>
      async (message: string) =>
        await runWithWalletSignatureStatus({
          provider: 'native',
          message,
          run: async () => {
            const activeAccounts = normalizeWalletAccounts(await connector.getAccounts());
            if (
              !activeAccounts.some((activeAddress) =>
                ethereumAddressesEqual(activeAddress, accountAddress)
              )
            ) {
              throw new Error(
                'The selected wallet account is no longer active. Reconnect it and retry.'
              );
            }
            return await signMessageWithConnector(wagmiConfigNative, {
              connector,
              account: accountAddress as `0x${string}`,
              message,
            });
          },
        }),
    []
  );

  const completeConnectorResult = useCallback(
    (connector: Connector, result: WalletConnectResult | undefined) => {
      const connectedAddress = result?.accounts?.[0];
      return result && connectedAddress
        ? {
            ...result,
            signMessage: createConnectorBoundSigner(connector, connectedAddress),
          }
        : result;
    },
    [createConnectorBoundSigner]
  );

  const clearPendingWalletConnection = useCallback(() => {
    clearWalletConnectionIntent();
    setPendingWalletConnection(null);
    resumePromiseRef.current = null;
  }, []);

  const connectWallet = useCallback(
    async (option: WalletOption, request: WalletConnectRequest = {}) => {
      const connector = resolveWalletConnector(option, connectors);
      if (!connector) {
        throw new Error(`${option.name} is not available in this browser. Choose another wallet.`);
      }

      const intent = createWalletConnectionIntent({
        flow: request.flow,
        connectorId: connector.id,
        connectorName: connector.name,
      });
      persistWalletConnectionIntent(intent);
      setPendingWalletConnection(intent);

      // Wagmi does not publish connector `connect` events while its connect
      // mutation is pending. Listen to the exact connector as well as the
      // mutation so a completed mobile handoff can settle this app-level call.
      const recovery = waitForWalletConnectorReturn(connector);
      const connectorOutcome = connectAsync({ connector }).then(
        (result) => ({ type: 'connected' as const, result: normalizeConnectResult(result) }),
        (error: unknown) => ({ type: 'error' as const, error })
      );

      try {
        const outcome = await Promise.race([
          connectorOutcome,
          recovery.promise.then((result) => ({ type: 'connected' as const, result })),
        ]);
        if (outcome.type === 'error') {
          if (isWalletConnectionCancellation(outcome.error)) {
            clearWalletConnectionIntent(intent.attemptId);
            setPendingWalletConnection((current) =>
              current?.attemptId === intent.attemptId ? null : current
            );
          }
          throw outcome.error;
        }
        return completeConnectorResult(connector, outcome.result);
      } finally {
        // connectorOutcome handles both late resolution and late rejection, so
        // a relay response that arrives after recovery cannot become unhandled.
        recovery.cleanup();
      }
    },
    [completeConnectorResult, connectAsync, connectors]
  );

  const resumeWalletConnection = useCallback(
    async (flow?: WalletConnectionFlow) => {
      const intent = readWalletConnectionIntent();
      setPendingWalletConnection(intent);
      if (!intent || (flow && intent.flow !== flow)) return undefined;

      const existing = resumePromiseRef.current;
      if (existing?.attemptId === intent.attemptId) return await existing.promise;

      const promise = (async () => {
        const connector = connectors.find(
          (candidate) =>
            candidate.id === intent.connectorId && candidate.name === intent.connectorName
        );
        if (!connector) return undefined;

        for (const delayMs of walletReturnProbeDelays) {
          if (delayMs) await wait(delayMs);
          const current = readWalletConnectionIntent();
          if (!current || current.attemptId !== intent.attemptId) return undefined;
          if (
            typeof document !== 'undefined' &&
            document.visibilityState === 'hidden'
          ) {
            return undefined;
          }
          const result = await probeWalletConnector(connector);
          if (result?.accounts?.[0]) {
            return completeConnectorResult(connector, result);
          }
        }
        return undefined;
      })();

      resumePromiseRef.current = { attemptId: intent.attemptId, promise };
      try {
        return await promise;
      } finally {
        if (resumePromiseRef.current?.promise === promise) {
          resumePromiseRef.current = null;
        }
      }
    },
    [completeConnectorResult, connectors]
  );

  const disconnectWallet = useCallback(async () => {
    clearPendingWalletConnection();
    await disconnectAsync();
  }, [clearPendingWalletConnection, disconnectAsync]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WALLET_CONNECTION_INTENT_STORAGE_KEY) {
        setPendingWalletConnection(readWalletConnectionIntent());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
      pendingWalletConnection,
      connectWallet,
      resumeWalletConnection,
      clearPendingWalletConnection,
      disconnectWallet,
      signMessage,
    }),
    [
      account.address,
      account.chainId,
      connectWallet,
      clearPendingWalletConnection,
      disconnectWallet,
      isConnecting,
      isDisconnecting,
      pendingWalletConnection,
      resumeWalletConnection,
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
