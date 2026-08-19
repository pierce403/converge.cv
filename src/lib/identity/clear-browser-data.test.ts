import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { clearAllBrowserData } from './clear-browser-data';
import { useAuthStore, useInboxRegistryStore } from '@/lib/stores';

const resetXmtpClientMock = vi.fn();
const closeStorageMock = vi.fn();
const disablePushMock = vi.fn();

vi.mock('@/lib/xmtp/client', () => ({
  resetXmtpClient: () => resetXmtpClientMock(),
}));

vi.mock('@/lib/storage', () => ({
  closeStorage: () => closeStorageMock(),
}));

vi.mock('@/lib/push', () => ({
  disablePush: () => disablePushMock(),
}));

describe('clearAllBrowserData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('converge.inboxRegistry.v1', JSON.stringify([{ inboxId: 'test-inbox-1' }]));
    window.localStorage.setItem('test-key', 'test-value');
    window.sessionStorage.setItem('test-session', 'value');
  });

  it('wipes all local storage, stores, and databases, then navigates to onboarding', async () => {
    const dexieDeleteSpy = vi.spyOn(Dexie, 'delete').mockResolvedValue(undefined as never);
    const replaceSpy = vi.fn();
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { replace: (url: string) => void; pathname: string; hostname: string } }).location = {
      replace: replaceSpy,
      pathname: '/settings',
      hostname: 'converge.cv',
    };

    useAuthStore.setState({
      isAuthenticated: true,
      identity: {
        address: '0x1234567890123456789012345678901234567890',
        publicKey: '0x01',
        createdAt: 1,
        inboxId: 'test-inbox-1',
      },
    });
    useInboxRegistryStore.setState({
      entries: [{ inboxId: 'test-inbox-1', displayLabel: 'Test', primaryDisplayIdentity: 'Test', lastOpenedAt: 1, hasLocalDB: true }],
      currentInboxId: 'test-inbox-1',
    });

    await clearAllBrowserData();

    expect(disablePushMock).toHaveBeenCalled();
    expect(resetXmtpClientMock).toHaveBeenCalled();
    expect(closeStorageMock).toHaveBeenCalled();
    expect(dexieDeleteSpy).toHaveBeenCalledWith('ConvergeDB');
    expect(dexieDeleteSpy).toHaveBeenCalledWith('ConvergeDB:default');
    expect(dexieDeleteSpy).toHaveBeenCalledWith('ConvergeDB:test-inbox-1');
    expect(dexieDeleteSpy).toHaveBeenCalledWith('ConvergePushState');

    // Storage is cleared
    expect(window.localStorage.getItem('test-key')).toBeNull();
    expect(window.sessionStorage.getItem('test-session')).toBeNull();

    // Zustand stores are reset
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().identity).toBeNull();
    expect(useInboxRegistryStore.getState().entries).toEqual([]);
    expect(useInboxRegistryStore.getState().currentInboxId).toBeNull();

    // Navigated to onboarding
    expect(replaceSpy).toHaveBeenCalledWith('/onboarding');
  });

  it('continues and finishes wiping local data even if remote push cleanup throws', async () => {
    disablePushMock.mockRejectedValueOnce(new Error('Network error on relay'));
    const dexieDeleteSpy = vi.spyOn(Dexie, 'delete').mockResolvedValue(undefined as never);
    const replaceSpy = vi.fn();
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { replace: (url: string) => void; pathname: string; hostname: string } }).location = {
      replace: replaceSpy,
      pathname: '/settings',
      hostname: 'converge.cv',
    };

    await clearAllBrowserData();

    expect(dexieDeleteSpy).toHaveBeenCalledWith('ConvergeDB');
    expect(window.localStorage.length).toBe(0);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(replaceSpy).toHaveBeenCalledWith('/onboarding');
  });
});
