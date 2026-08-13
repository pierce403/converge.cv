import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { InstallationsSettings } from './InstallationsSettings';

const inboxId = 'a'.repeat(64);
const savedInstallationId = 'b'.repeat(64);

const xmtpMock = vi.hoisted(() => ({
  isConnected: vi.fn(() => false),
  getInboxState: vi.fn(),
  getInboxStateById: vi.fn(),
  getInstallationId: vi.fn(() => null),
  getKeyPackageStatuses: vi.fn(),
  revokeInstallations: vi.fn(),
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: () => xmtpMock,
}));

describe('InstallationsSettings disconnected ledger view', () => {
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
});
