import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletSelector } from './WalletSelector';

const walletState = vi.hoisted(() => ({
  provider: 'native' as 'native' | 'thirdweb',
  address: undefined as string | undefined,
  chainId: undefined as number | undefined,
  isConnecting: false,
  connectWallet: vi.fn(),
  signMessage: undefined as
    | ((message: string, accountAddress?: string) => Promise<string>)
    | undefined,
  walletOptions: [
    {
      id: 'coinbase',
      name: 'Base Wallet',
      icon: '*',
      provider: 'native' as const,
    },
  ],
}));

vi.mock('@/lib/wagmi', () => ({
  useWalletConnection: () => walletState,
}));

vi.mock('@/components/WalletProviderSelector', () => ({
  WalletProviderSelector: () => <div>Provider selector</div>,
}));

vi.mock('@/components/ThirdwebConnectButton', () => ({
  ThirdwebConnectButton: ({
    onConnected,
  }: {
    onConnected: (
      address: string,
      chainId: number,
      signMessage: (message: string) => Promise<string>
    ) => void;
  }) => (
    <button
      onClick={() =>
        onConnected('0x2222222222222222222222222222222222222222', 8453, async () => '0xsigned')
      }
    >
      Thirdweb test connect
    </button>
  ),
}));

describe('WalletSelector', () => {
  beforeEach(() => {
    walletState.provider = 'native';
    walletState.address = undefined;
    walletState.chainId = undefined;
    walletState.isConnecting = false;
    walletState.connectWallet.mockReset();
    walletState.signMessage = undefined;
  });

  it('starts the connector before continuing and emits one transition when account state races', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const signMessage = vi.fn(async () => '0xnative-signed');
    walletState.connectWallet.mockResolvedValue({ accounts: [address], chainId: 8453, signMessage });
    const onWalletConnected = vi.fn(
      async (
        _address: string,
        _chainId?: number,
        _signMessage?: (message: string) => Promise<string>
      ) => undefined
    );
    const { rerender } = render(
      <WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />
    );

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    await waitFor(() => expect(walletState.connectWallet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, signMessage));
    expect(await onWalletConnected.mock.calls[0]?.[2]?.('approve')).toBe('0xnative-signed');

    walletState.address = address;
    walletState.chainId = 8453;
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledTimes(1));
  });

  it('forwards an account-bound Thirdweb signer instead of snapshotting provider state', async () => {
    walletState.provider = 'thirdweb';
    const onWalletConnected = vi.fn(
      async (
        _address: string,
        _chainId?: number,
        _signMessage?: (message: string) => Promise<string>
      ) => undefined
    );
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /thirdweb test connect/i }));

    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledTimes(1));
    const signer = onWalletConnected.mock.calls[0]?.[2];
    expect(await signer?.('approve')).toBe('0xsigned');
  });

  it('waits for the native connector signer when account state updates before connect resolves', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const connectorSigner = vi.fn(async () => '0xconnector-signed');
    let finishConnect: ((value: {
      accounts: string[];
      chainId: number;
      signMessage: typeof connectorSigner;
    }) => void) | undefined;
    walletState.connectWallet.mockReturnValue(
      new Promise((resolve) => {
        finishConnect = resolve;
      })
    );
    const onWalletConnected = vi.fn(async () => undefined);
    const { rerender } = render(
      <WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />
    );

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));
    walletState.address = address;
    walletState.chainId = 8453;
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);
    expect(onWalletConnected).not.toHaveBeenCalled();

    finishConnect?.({ accounts: [address], chainId: 8453, signMessage: connectorSigner });
    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, connectorSigner)
    );
  });

  it('allows the same wallet account to retry after onboarding continuation fails', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    walletState.connectWallet.mockResolvedValue({ accounts: [address], chainId: 8453 });
    const onWalletConnected = vi
      .fn()
      .mockRejectedValueOnce(new Error('XMTP probe failed'))
      .mockResolvedValueOnce(undefined);
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    const connectButton = screen.getByRole('button', { name: /base wallet/i });
    fireEvent.click(connectButton);
    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledTimes(1));

    fireEvent.click(connectButton);
    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledTimes(2));
  });

  it('surfaces the original native continuation error even without a capital Failed token', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    walletState.connectWallet.mockResolvedValue({ accounts: [address], chainId: 8453 });
    const onWalletConnected = vi
      .fn()
      .mockRejectedValue(new Error('XMTP identity endpoint is cooling down'));
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    expect(await screen.findByText('XMTP identity endpoint is cooling down')).toBeInTheDocument();
  });

  it('keeps intentional native rejection and timeout errors concise', async () => {
    walletState.connectWallet.mockRejectedValueOnce(new Error('user rejected request'));
    const onWalletConnected = vi.fn();
    const { rerender } = render(
      <WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />
    );

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));
    expect(await screen.findByText('Connection cancelled. Please try again.')).toBeInTheDocument();

    walletState.connectWallet.mockRejectedValueOnce(new Error('session_request listeners timed out'));
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));
    expect(await screen.findByText('Connection timeout. Please try again.')).toBeInTheDocument();
  });

  it('shows Thirdweb continuation failures inside the wallet selector', async () => {
    walletState.provider = 'thirdweb';
    const onWalletConnected = vi.fn().mockRejectedValue(new Error('XMTP probe failed'));
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /thirdweb test connect/i }));

    expect(await screen.findByText('XMTP probe failed')).toBeInTheDocument();
  });

  it('can retry a failed Thirdweb check after the account is already connected', async () => {
    walletState.provider = 'thirdweb';
    walletState.address = '0x2222222222222222222222222222222222222222';
    walletState.chainId = 8453;
    const onWalletConnected = vi
      .fn()
      .mockRejectedValueOnce(new Error('XMTP probe failed'))
      .mockResolvedValueOnce(undefined);
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    expect(await screen.findByText('XMTP probe failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry wallet check/i }));

    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledTimes(2));
  });
});
