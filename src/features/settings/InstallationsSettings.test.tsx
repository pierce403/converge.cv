import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentifierKind } from '@xmtp/browser-sdk';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { InstallationsSettings } from './InstallationsSettings';

const inboxId = 'a'.repeat(64);
const savedInstallationId = 'b'.repeat(64);
const setAuthIdentity = useAuthStore.getState().setIdentity;

interface InboxStateFixture {
  inboxId: string;
  installations: Array<{
    id: string;
    bytes: Uint8Array;
    clientTimestampNs: bigint;
  }>;
  accountIdentifiers: never[];
  recoveryIdentifier?: {
    identifierKind: IdentifierKind;
    identifier: string;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const xmtpMock = vi.hoisted(() => ({
  isConnected: vi.fn(() => false),
  getInboxState: vi.fn(),
  getInboxStateById: vi.fn(),
  getInstallationId: vi.fn<() => string | null>(() => null),
  getKeyPackageStatuses: vi.fn(),
  revokeInstallations: vi.fn(),
  revokeInstallationsWithRecoveryIdentity: vi.fn(),
  revokeInstallationsWithSigner: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  putIdentity: vi.fn(),
}));

const walletState = vi.hoisted(() => ({
  address: undefined as string | undefined,
  chainId: undefined as number | undefined,
  isConnected: false,
  isConnecting: false,
  isDisconnecting: false,
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  signMessage: undefined as
    | ((message: string, accountAddress?: string) => Promise<string>)
    | undefined,
  walletOptions: [
    {
      id: 'coinbase',
      name: 'Base Wallet',
      icon: '🔵',
    },
    {
      id: 'metamask',
      name: 'MetaMask',
      icon: '🦊',
    },
  ],
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => xmtpMock,
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => ({
    putIdentity: storageMock.putIdentity,
  })),
}));

vi.mock('@/lib/wagmi', () => ({
  useWalletConnection: () => walletState,
  wagmiConfigNative: {},
}));

describe('InstallationsSettings ledger view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
    walletState.address = undefined;
    walletState.chainId = undefined;
    walletState.isConnected = false;
    walletState.isConnecting = false;
    walletState.connectWallet.mockReset();
    walletState.signMessage = undefined;
    xmtpMock.isConnected.mockReturnValue(false);
    xmtpMock.getInstallationId.mockReturnValue(null);
    xmtpMock.getInboxStateById.mockResolvedValue({
      inboxId,
      recoveryIdentifier: {
        identifierKind: IdentifierKind.Ethereum,
        identifier: `0x${'11'.repeat(20)}`,
      },
      installations: [
        { id: savedInstallationId, bytes: new Uint8Array([1]), clientTimestampNs: 1n },
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `other-${index}`,
          bytes: new Uint8Array([index + 2]),
          clientTimestampNs: BigInt(index + 2),
        })),
      ],
      accountIdentifiers: [],
    });
    useAuthStore.setState({
      identity: {
        address: `0x${'11'.repeat(20)}`,
        publicKey: '0x01',
        privateKey: `0x${'22'.repeat(32)}`,
        createdAt: 1,
        inboxId,
        installationId: savedInstallationId,
        xmtpDbPathMode: 'inbox-default',
      },
      setIdentity: setAuthIdentity,
    });
    useXmtpStore.setState({
      connectionStatus: 'error',
      installationRecovery: {
        reason: 'installation-mismatch',
        inboxId,
        expectedInstallationId: savedInstallationId,
        localInstallationId: 'candidate-new',
        expectedInstallationVisible: true,
        localInstallationVisible: false,
        localInstallationRegistered: false,
        signerIsRecoveryIdentifier: true,
        existingInstallationCount: 8,
        databasePathMode: 'inbox-default',
      },
    });
  });

  it('loads the known inbox without creating a client and labels the unavailable saved installation', async () => {
    render(<InstallationsSettings />);

    await waitFor(() =>
      expect(screen.getByText('All Installations (8/10)')).toBeInTheDocument()
    );
    expect(xmtpMock.getInboxStateById).toHaveBeenCalledWith(inboxId);
    expect(xmtpMock.getInboxState).not.toHaveBeenCalled();
    expect(screen.getByText('Saved, unavailable here')).toBeInTheDocument();
    expect(
      screen.getByText(/revocation is disabled until XMTP reconnects/i)
    ).toBeInTheDocument();
  });

  it('does not let a stale installation load overwrite a repaired identity', async () => {
    const staleRequest = deferred<InboxStateFixture>();
    const repairedInstallationId = 'c'.repeat(64);
    const initialIdentity = {
      address: `0x${'11'.repeat(20)}`,
      publicKey: '0x01',
      privateKey: `0x${'22'.repeat(32)}`,
      createdAt: 1,
      inboxId,
      installationId: savedInstallationId,
      xmtpDbPathMode: 'legacy-address' as const,
    };
    const repairedIdentity = {
      ...initialIdentity,
      installationId: repairedInstallationId,
      staleInstallationId: savedInstallationId,
      xmtpDbPathMode: 'inbox-default' as const,
      installationRepairPending: true,
    };
    const setIdentity = vi.fn();

    useAuthStore.setState({ identity: initialIdentity, setIdentity });
    useXmtpStore.setState({ connectionStatus: 'error' });
    xmtpMock.isConnected.mockReturnValue(false);
    xmtpMock.getInboxStateById.mockReturnValue(staleRequest.promise);
    xmtpMock.getInstallationId.mockReturnValue(savedInstallationId);
    xmtpMock.getKeyPackageStatuses.mockResolvedValue(new Map());

    render(<InstallationsSettings />);
    await waitFor(() => expect(xmtpMock.getInboxStateById).toHaveBeenCalledOnce());

    xmtpMock.isConnected.mockReturnValue(true);
    xmtpMock.getInstallationId.mockReturnValue(repairedInstallationId);
    xmtpMock.getInboxState.mockResolvedValue({
      inboxId,
      recoveryIdentifier: {
        identifierKind: IdentifierKind.Ethereum,
        identifier: `0x${'11'.repeat(20)}`,
      },
      installations: [
        {
          id: repairedInstallationId,
          bytes: new Uint8Array([2]),
          clientTimestampNs: 2n,
        },
      ],
      accountIdentifiers: [],
    });
    act(() => {
      useAuthStore.setState({ identity: repairedIdentity });
      useXmtpStore.setState({ connectionStatus: 'connected' });
    });
    await waitFor(() => expect(xmtpMock.getInboxState).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText('All Installations (1/10)')).toBeInTheDocument()
    );

    await act(async () => {
      staleRequest.resolve({
        inboxId,
        recoveryIdentifier: {
          identifierKind: IdentifierKind.Ethereum,
          identifier: `0x${'11'.repeat(20)}`,
        },
        installations: [
          {
            id: repairedInstallationId,
            bytes: new Uint8Array([2]),
            clientTimestampNs: 2n,
          },
          {
            id: savedInstallationId,
            bytes: new Uint8Array([1]),
            clientTimestampNs: 1n,
          },
        ],
        accountIdentifiers: [],
      });
      await staleRequest.promise;
      await Promise.resolve();
    });

    expect(screen.getByText('All Installations (1/10)')).toBeInTheDocument();
    expect(storageMock.putIdentity).not.toHaveBeenCalled();
    expect(setIdentity).not.toHaveBeenCalled();
    expect(useAuthStore.getState().identity).toEqual(repairedIdentity);
  });

  it('revokes directly when local identity is the recovery identifier', async () => {
    xmtpMock.isConnected.mockReturnValue(true);
    xmtpMock.getInstallationId.mockReturnValue(savedInstallationId);
    xmtpMock.getInboxState.mockResolvedValue({
      inboxId,
      recoveryIdentifier: {
        identifierKind: IdentifierKind.Ethereum,
        identifier: `0x${'11'.repeat(20)}`,
      },
      installations: [
        { id: savedInstallationId, bytes: new Uint8Array([1]), clientTimestampNs: 1n },
        { id: 'other-device', bytes: new Uint8Array([2]), clientTimestampNs: 2n },
      ],
      accountIdentifiers: [],
    });
    xmtpMock.getKeyPackageStatuses.mockResolvedValue(new Map());
    useXmtpStore.setState({ connectionStatus: 'connected' });

    render(<InstallationsSettings />);
    await waitFor(() => expect(screen.getByText('All Installations (2/10)')).toBeInTheDocument());

    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    expect(revokeButtons.length).toBe(1);

    fireEvent.click(revokeButtons[0]);

    await waitFor(() => {
      expect(xmtpMock.revokeInstallationsWithRecoveryIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          address: `0x${'11'.repeat(20)}`,
          privateKey: `0x${'22'.repeat(32)}`,
        }),
        inboxId,
        [new Uint8Array([2])]
      );
    });
    expect(window.alert).toHaveBeenCalledWith('Installation revoked successfully!');
  });

  it('prompts to connect recovery wallet when local identity is not recovery identifier', async () => {
    const recoveryWalletAddress = '0x9999999999999999999999999999999999999999';
    const localDeviceAddress = '0x8888888888888888888888888888888888888888';

    useAuthStore.setState({
      identity: {
        address: localDeviceAddress,
        publicKey: '0x01',
        privateKey: '0xkey',
        createdAt: 1,
        inboxId,
        installationId: savedInstallationId,
        xmtpDbPathMode: 'inbox-default',
      },
    });

    xmtpMock.isConnected.mockReturnValue(true);
    xmtpMock.getInstallationId.mockReturnValue(savedInstallationId);
    xmtpMock.getInboxState.mockResolvedValue({
      inboxId,
      recoveryIdentifier: {
        identifierKind: IdentifierKind.Ethereum,
        identifier: recoveryWalletAddress,
      },
      installations: [
        { id: savedInstallationId, bytes: new Uint8Array([1]), clientTimestampNs: 1n },
        { id: 'other-device', bytes: new Uint8Array([2]), clientTimestampNs: 2n },
      ],
      accountIdentifiers: [],
    });
    xmtpMock.getKeyPackageStatuses.mockResolvedValue(new Map());
    useXmtpStore.setState({ connectionStatus: 'connected' });

    render(<InstallationsSettings />);
    await waitFor(() => expect(screen.getByText('All Installations (2/10)')).toBeInTheDocument());

    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    fireEvent.click(revokeButtons[0]);

    // Should open the recovery wallet modal
    await waitFor(() => {
      expect(screen.getByText('Authorize Revocation')).toBeInTheDocument();
      expect(screen.getByText(recoveryWalletAddress)).toBeInTheDocument();
    });

    // Connecting the recovery wallet
    const signMessage = vi.fn(async () => '0xwallet-signed');
    walletState.connectWallet.mockResolvedValue({
      accounts: [recoveryWalletAddress],
      chainId: 1,
      signMessage,
    });

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    await waitFor(() => {
      expect(walletState.connectWallet).toHaveBeenCalled();
      expect(xmtpMock.revokeInstallationsWithRecoveryIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          address: recoveryWalletAddress,
          signMessage,
        }),
        inboxId,
        [new Uint8Array([2])]
      );
    });
  });

  it('displays error if connected wallet does not match the recovery address', async () => {
    const recoveryWalletAddress = '0x9999999999999999999999999999999999999999';
    const localDeviceAddress = '0x8888888888888888888888888888888888888888';
    const wrongWalletAddress = '0x7777777777777777777777777777777777777777';

    useAuthStore.setState({
      identity: {
        address: localDeviceAddress,
        publicKey: '0x01',
        privateKey: '0xkey',
        createdAt: 1,
        inboxId,
        installationId: savedInstallationId,
        xmtpDbPathMode: 'inbox-default',
      },
    });

    xmtpMock.isConnected.mockReturnValue(true);
    xmtpMock.getInstallationId.mockReturnValue(savedInstallationId);
    xmtpMock.getInboxState.mockResolvedValue({
      inboxId,
      recoveryIdentifier: {
        identifierKind: IdentifierKind.Ethereum,
        identifier: recoveryWalletAddress,
      },
      installations: [
        { id: savedInstallationId, bytes: new Uint8Array([1]), clientTimestampNs: 1n },
        { id: 'other-device', bytes: new Uint8Array([2]), clientTimestampNs: 2n },
      ],
      accountIdentifiers: [],
    });
    xmtpMock.getKeyPackageStatuses.mockResolvedValue(new Map());
    useXmtpStore.setState({ connectionStatus: 'connected' });

    render(<InstallationsSettings />);
    await waitFor(() => expect(screen.getByText('All Installations (2/10)')).toBeInTheDocument());

    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    fireEvent.click(revokeButtons[0]);

    await waitFor(() => expect(screen.getByText('Authorize Revocation')).toBeInTheDocument());

    walletState.connectWallet.mockResolvedValue({
      accounts: [wrongWalletAddress],
      chainId: 1,
      signMessage: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /base wallet/i }));

    await waitFor(() => {
      expect(screen.getByText(/does not match the recovery wallet/i)).toBeInTheDocument();
    });
    expect(xmtpMock.revokeInstallationsWithRecoveryIdentity).not.toHaveBeenCalled();
  });
});

