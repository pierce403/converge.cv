import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

const storageMock = vi.hoisted(() => ({
  putIdentity: vi.fn(),
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => xmtpMock,
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => ({
    putIdentity: storageMock.putIdentity,
  })),
}));

describe('InstallationsSettings ledger view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    xmtpMock.isConnected.mockReturnValue(false);
    xmtpMock.getInstallationId.mockReturnValue(null);
    xmtpMock.getInboxStateById.mockResolvedValue({
      inboxId,
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
    // Keep the stale callback from triggering a third corrective reload so this
    // assertion also proves the older response cannot replace newer UI state.
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
});
