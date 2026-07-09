import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletSelector } from './WalletSelector';

const walletState = vi.hoisted(() => ({
  provider: 'native' as 'native' | 'thirdweb',
  address: undefined as string | undefined,
  chainId: undefined as number | undefined,
  isConnecting: false,
  connectWallet: vi.fn(),
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
  });

  it('starts the connector before continuing and emits one transition when account state races', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    walletState.connectWallet.mockResolvedValue({ accounts: [address], chainId: 8453 });
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
    await waitFor(() => expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, undefined));

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
