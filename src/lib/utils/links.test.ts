import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const importLinks = async () => import('./links');

describe('links utils', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns configured OG base without trailing slash', async () => {
    vi.stubEnv('VITE_OG_BASE', 'https://og.example.com/');
    const { getOgBase } = await importLinks();

    expect(getOgBase()).toBe('https://og.example.com');
  });

  it('falls back to window origin when OG base is empty', async () => {
    vi.stubEnv('VITE_OG_BASE', '');
    const { getOgBase } = await importLinks();

    expect(getOgBase()).toBe(window.location.origin);
  });

  it('builds share URLs with encoding', async () => {
    vi.stubEnv('VITE_OG_BASE', 'https://og.example.com');
    const { inboxShareUrl, userShareUrl } = await importLinks();

    expect(inboxShareUrl('inbox id')).toBe('https://og.example.com/i/inbox%20id');
    expect(userShareUrl('user/id')).toBe('https://og.example.com/u/user%2Fid');
  });
});
