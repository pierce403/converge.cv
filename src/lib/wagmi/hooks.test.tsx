import { act, render, waitFor } from '@testing-library/react';
import type { Connector } from '@wagmi/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WalletConnectionProvider,
  useWalletConnection,
  type WalletConnectResult,
  type WalletConnectionValue,
  type WalletOption,
} from './hooks';

const wagmiMocks = vi.hoisted(() => ({
  connectAsync: vi.fn(),
  disconnectAsync: vi.fn(async () => undefined),
  connectors: [] as Connector[],
  signMessageAsync: vi.fn(),
}));

const coreMocks = vi.hoisted(() => ({
  signMessage: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, chainId: undefined }),
  useConnect: () => ({
    connectAsync: wagmiMocks.connectAsync,
    isPending: false,
  }),
  useConnectors: () => wagmiMocks.connectors,
  useDisconnect: () => ({
    disconnectAsync: wagmiMocks.disconnectAsync,
    isPending: false,
  }),
  useSignMessage: () => ({ signMessageAsync: wagmiMocks.signMessageAsync }),
}));

vi.mock('@wagmi/core', () => ({
  signMessage: coreMocks.signMessage,
}));

vi.mock('@/lib/wagmi/config', () => ({
  wagmiConfigNative: { id: 'test-wagmi-config' },
}));

type ConnectorEvent = 'connect' | 'change';
type ConnectorEventValue = {
  accounts?: readonly `0x${string}`[];
  chainId?: number;
};

function createTestConnector({
  id,
  name,
  address,
}: {
  id: string;
  name: string;
  address: `0x${string}`;
}) {
  const listeners = new Map<
    ConnectorEvent,
    Set<(value: ConnectorEventValue) => void>
  >();
  let authorized = false;

  const connector = {
    id,
    name,
    getAccounts: vi.fn(async () => (authorized ? [address] : [])),
    getChainId: vi.fn(async () => 8453),
    emitter: {
      on: vi.fn(
        (event: ConnectorEvent, listener: (value: ConnectorEventValue) => void) => {
          const eventListeners =
            listeners.get(event) ??
            new Set<(value: ConnectorEventValue) => void>();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        }
      ),
      off: vi.fn(
        (event: ConnectorEvent, listener: (value: ConnectorEventValue) => void) => {
          listeners.get(event)?.delete(listener);
        }
      ),
    },
  } as unknown as Connector;

  return {
    connector,
    authorizeAndEmit(event: ConnectorEvent) {
      authorized = true;
      const value = { accounts: [address], chainId: 8453 } as const;
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
  };
}

let walletConnection: WalletConnectionValue | undefined;

function CaptureWalletConnection() {
  walletConnection = useWalletConnection();
  return null;
}

function renderWalletProvider() {
  render(
    <WalletConnectionProvider>
      <CaptureWalletConnection />
    </WalletConnectionProvider>
  );
  expect(walletConnection).toBeDefined();
}

function beginConnection(option: WalletOption) {
  let resultPromise: Promise<WalletConnectResult | undefined> | undefined;
  act(() => {
    resultPromise = walletConnection?.connectWallet(option, { flow: 'onboarding' });
  });
  expect(resultPromise).toBeDefined();
  return resultPromise as Promise<WalletConnectResult | undefined>;
}

describe('WalletConnectionProvider mobile return recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    walletConnection = undefined;
    wagmiMocks.connectAsync.mockReset();
    wagmiMocks.disconnectAsync.mockClear();
    wagmiMocks.connectors = [];
    wagmiMocks.signMessageAsync.mockReset();
    coreMocks.signMessage.mockReset();
  });

  it.each(['connect', 'change'] as const)(
    'settles a pending connectAsync from the exact connector %s event with an account-bound signer',
    async (event) => {
      const address = '0x1111111111111111111111111111111111111111';
      const selected = createTestConnector({
        id: 'metaMaskSDK',
        name: 'MetaMask',
        address,
      });
      wagmiMocks.connectors = [selected.connector];
      wagmiMocks.connectAsync.mockReturnValue(new Promise(() => undefined));
      coreMocks.signMessage.mockResolvedValue('0xaccount-bound-signature');
      renderWalletProvider();

      const completion = vi.fn();
      const resultPromise = beginConnection({
        id: 'metamask',
        name: 'MetaMask',
        icon: '*',
        connectorId: 'metaMaskSDK',
      }).then((result) => {
        completion(result);
        return result;
      });

      expect(wagmiMocks.connectAsync).toHaveBeenCalledWith({
        connector: selected.connector,
      });

      selected.authorizeAndEmit(event);
      const result = await resultPromise;

      expect(result?.accounts).toEqual([address]);
      expect(result?.chainId).toBe(8453);
      expect(completion).toHaveBeenCalledTimes(1);
      expect(await result?.signMessage?.('XMTP challenge')).toBe(
        '0xaccount-bound-signature'
      );
      expect(coreMocks.signMessage).toHaveBeenCalledWith(
        { id: 'test-wagmi-config' },
        {
          connector: selected.connector,
          account: address,
          message: 'XMTP challenge',
        }
      );
    }
  );

  it('honors the connector ID when connectors have duplicate display names', async () => {
    const address = '0x2222222222222222222222222222222222222222';
    const wrong = createTestConnector({
      id: 'injected',
      name: 'MetaMask',
      address: '0x3333333333333333333333333333333333333333',
    });
    const selected = createTestConnector({
      id: 'walletConnect',
      name: 'MetaMask',
      address,
    });
    wagmiMocks.connectors = [wrong.connector, selected.connector];
    wagmiMocks.connectAsync.mockReturnValue(new Promise(() => undefined));
    renderWalletProvider();

    let settled = false;
    const resultPromise = beginConnection({
      id: 'metamask-mobile',
      name: 'MetaMask',
      icon: '*',
      connectorId: 'walletConnect',
      connectorName: 'MetaMask',
    }).then((result) => {
      settled = true;
      return result;
    });

    expect(wagmiMocks.connectAsync).toHaveBeenCalledWith({
      connector: selected.connector,
    });
    wrong.authorizeAndEmit('connect');
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    selected.authorizeAndEmit('connect');
    expect((await resultPromise)?.accounts).toEqual([address]);
    expect(wrong.connector.emitter.on).not.toHaveBeenCalled();
  });

  it('absorbs a late connector rejection after recovery without completing twice', async () => {
    const address = '0x4444444444444444444444444444444444444444';
    const selected = createTestConnector({
      id: 'metaMaskSDK',
      name: 'MetaMask',
      address,
    });
    let rejectConnector: ((reason: Error) => void) | undefined;
    wagmiMocks.connectors = [selected.connector];
    wagmiMocks.connectAsync.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectConnector = reject;
      })
    );
    renderWalletProvider();

    const completion = vi.fn();
    const resultPromise = beginConnection({
      id: 'metamask',
      name: 'MetaMask',
      icon: '*',
      connectorId: 'metaMaskSDK',
    }).then(completion);

    selected.authorizeAndEmit('change');
    await resultPromise;
    expect(completion).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectConnector?.(new Error('relay closed after wallet approval'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it('clears the persisted handoff when the user rejects the wallet request', async () => {
    const selected = createTestConnector({
      id: 'metaMaskSDK',
      name: 'MetaMask',
      address: '0x5555555555555555555555555555555555555555',
    });
    wagmiMocks.connectors = [selected.connector];
    wagmiMocks.connectAsync.mockRejectedValue(
      Object.assign(new Error('User rejected request'), { code: 4001 })
    );
    renderWalletProvider();

    await expect(
      beginConnection({
        id: 'metamask',
        name: 'MetaMask',
        icon: '*',
        connectorId: 'metaMaskSDK',
      })
    ).rejects.toThrow('User rejected request');

    await waitFor(() => expect(walletConnection?.pendingWalletConnection).toBeNull());
    expect(localStorage.length).toBe(0);
  });
});
