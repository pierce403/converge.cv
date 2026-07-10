import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletSelector } from './WalletSelector';
import { WalletInspectionRequiredError } from '@/lib/wagmi/wallet-inspection';

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

  it('canonicalizes repeated-prefix connector addresses before onboarding', async () => {
    const body = 'abcdefabcdef1234567890abcdefabcdef123456';
    const signMessage = vi.fn(async () => '0xnative-signed');
    walletState.connectWallet.mockResolvedValue({
      accounts: [`0X0x${body.toUpperCase()}`],
      chainId: 8453,
      signMessage,
    });
    const onWalletConnected = vi.fn(
      async (
        _address: string,
        _chainId?: number,
        _signMessage?: (message: string) => Promise<string>
      ) => undefined
    );
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(`0x${body}`, 8453, signMessage)
    );
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

  it('continues from a new provider account while the mobile connector is still pending', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const connectorSigner = vi.fn(async () => '0xconnector-signed');
    const providerSigner = vi.fn(async () => '0xprovider-signed');
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
    walletState.address = address;
    walletState.chainId = 8453;
    walletState.signMessage = providerSigner;
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, expect.any(Function))
    );
    const earlySigner = onWalletConnected.mock.calls[0]?.[2];
    expect(await earlySigner?.('approve')).toBe('0xprovider-signed');

    finishConnect?.({ accounts: [address], chainId: 8453, signMessage: connectorSigner });
    await waitFor(() => expect(walletState.connectWallet).toHaveBeenCalledTimes(1));
    expect(onWalletConnected).toHaveBeenCalledTimes(1);
    expect(connectorSigner).not.toHaveBeenCalled();
  });

  it('continues a mobile wallet return with an account and signer but no chain', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const providerSigner = vi.fn(async () => '0xprovider-signed');
    walletState.connectWallet.mockReturnValue(new Promise(() => undefined));
    const onWalletConnected = vi.fn(async () => undefined);
    const { rerender } = render(
      <WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />
    );

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));
    walletState.address = address;
    walletState.signMessage = providerSigner;
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(address, undefined, expect.any(Function))
    );
  });

  it('asks for an explicit wallet type only when inspection is unavailable', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const signMessage = vi.fn(async () => '0xsigned');
    walletState.connectWallet.mockResolvedValue({
      accounts: [address],
      chainId: 8453,
      signMessage,
    });
    const onWalletConnected = vi
      .fn()
      .mockRejectedValueOnce(new WalletInspectionRequiredError())
      .mockResolvedValueOnce(undefined);
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    expect(await screen.findByText('What kind of wallet is this?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regular wallet' }));

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenLastCalledWith(
        address,
        8453,
        signMessage,
        'EOA'
      )
    );
  });

  it('requires a connected chain before allowing the smart-account fallback', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    walletState.connectWallet.mockResolvedValue({ accounts: [address] });
    const onWalletConnected = vi
      .fn()
      .mockRejectedValue(new WalletInspectionRequiredError());
    render(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    expect(
      await screen.findByRole('button', { name: 'Smart account (such as Base app)' })
    ).toBeDisabled();
  });

  it('uses the latest provider chain when the connector result omits it', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const connectorSigner = vi.fn(async () => '0xconnector-signed');
    let finishConnect: ((value: {
      accounts: string[];
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
    finishConnect?.({ accounts: [address], signMessage: connectorSigner });

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, connectorSigner)
    );
  });

  it('resumes from provider state when a mobile connector returns without accounts', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const providerSigner = vi.fn(async () => '0xprovider-signed');
    let finishConnect: ((value: undefined) => void) | undefined;
    walletState.connectWallet.mockReturnValue(
      new Promise<undefined>((resolve) => {
        finishConnect = resolve;
      })
    );
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
    walletState.address = address;
    walletState.chainId = 8453;
    walletState.signMessage = providerSigner;
    rerender(<WalletSelector onWalletConnected={onWalletConnected} onBack={() => undefined} />);

    await waitFor(() =>
      expect(onWalletConnected).toHaveBeenCalledWith(address, 8453, expect.any(Function))
    );

    finishConnect?.(undefined);

    await waitFor(() => expect(walletState.connectWallet).toHaveBeenCalledTimes(1));
    expect(onWalletConnected).toHaveBeenCalledTimes(1);
    const signer = onWalletConnected.mock.calls[0]?.[2];
    expect(await signer?.('approve')).toBe('0xprovider-signed');
    expect(providerSigner).toHaveBeenCalledWith('approve', address);
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
