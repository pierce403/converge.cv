import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactLinkPage } from './ContactLinkPage';
import { useAuthStore } from '@/lib/stores';
import { resolveAddressOrENS } from '@/lib/utils/ens';

const navigateMock = vi.fn();
let paramsUserId: string | undefined;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ userId: paramsUserId }),
  };
});

vi.mock('@/lib/utils/ens', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils/ens')>('@/lib/utils/ens');
  return {
    ...actual,
    resolveAddressOrENS: vi.fn(),
  };
});

const resolveAddressOrENSMock = vi.mocked(resolveAddressOrENS);

describe('ContactLinkPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    paramsUserId = undefined;
    resolveAddressOrENSMock.mockReset();
    useAuthStore.setState({
      isAuthenticated: true,
      isVaultUnlocked: true,
      identity: null,
      vaultSecrets: null,
    });
  });

  it('redirects ENS names to /i/:address', async () => {
    paramsUserId = 'deanpierce.eth';
    resolveAddressOrENSMock.mockResolvedValue('0xabc0000000000000000000000000000000000000');

    render(<ContactLinkPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/i/0xabc0000000000000000000000000000000000000', {
        replace: true,
      });
    });
  });

  it('falls back to /new-chat when ENS cannot resolve', async () => {
    paramsUserId = 'deanpierce.eth';
    resolveAddressOrENSMock.mockResolvedValue(null);

    render(<ContactLinkPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/new-chat?to=deanpierce.eth', { replace: true });
    });
  });

  it('routes unauthenticated users to onboarding with u param', async () => {
    useAuthStore.setState({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    });
    paramsUserId = 'deanpierce.eth';

    render(<ContactLinkPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/onboarding?u=deanpierce.eth');
    });
  });
});

