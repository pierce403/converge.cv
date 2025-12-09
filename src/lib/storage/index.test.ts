import { beforeEach, describe, expect, it, vi } from 'vitest';

const closeMock = vi.fn(async () => undefined);
const initMock = vi.fn(async () => undefined);

vi.mock('./dexie-driver', () => ({
  DexieDriver: vi.fn().mockImplementation(() => ({
    init: initMock,
    close: closeMock,
  })),
}));

describe('storage namespace handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.resetModules();
  });

  it('reads persisted namespace on import and resets when changed', async () => {
    localStorage.setItem('converge.storageNamespace.v1', 'existing-ns');
    const storage = await import('./index');

    expect(storage.getStorageNamespace()).toBe('existing-ns');

    await storage.getStorage();
    expect(initMock).toHaveBeenCalled();

    await storage.setStorageNamespace('New Ns!');
    expect(storage.getStorageNamespace()).toBe('new_ns_');
    expect(closeMock).toHaveBeenCalled();
    expect(localStorage.getItem('converge.storageNamespace.v1')).toBe('new_ns_');
  });

  it('sanitizes empty namespace back to default', async () => {
    const storage = await import('./index');
    await storage.setStorageNamespace('   ');
    expect(storage.getStorageNamespace()).toBe('default');
  });
});
