import { beforeEach, describe, expect, it } from 'vitest';

import { clearRemovedIntegrationStorage } from './removed-integration-storage';

describe('removed integration storage cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes legacy Farcaster credentials and every Neynar cache entry', () => {
    localStorage.setItem(
      'converge-farcaster-settings',
      JSON.stringify({ state: { userNeynarApiKey: 'user-secret' } }),
    );
    localStorage.setItem('converge:neynar:cooldown-until', '1234');
    localStorage.setItem('converge:neynar:verification-miss:0xabc', '5678');
    localStorage.setItem('converge.unrelated', 'keep');

    clearRemovedIntegrationStorage(localStorage);

    expect(localStorage.getItem('converge-farcaster-settings')).toBeNull();
    expect(localStorage.getItem('converge:neynar:cooldown-until')).toBeNull();
    expect(localStorage.getItem('converge:neynar:verification-miss:0xabc')).toBeNull();
    expect(localStorage.getItem('converge.unrelated')).toBe('keep');
  });

  it('is safe when browser storage is unavailable', () => {
    expect(() => clearRemovedIntegrationStorage(null)).not.toThrow();
  });
});
