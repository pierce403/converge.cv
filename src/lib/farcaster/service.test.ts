import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveXmtpAddressFromFarcasterUser,
  resolveFidFromAddress,
  resolveContactName,
  fetchFarcasterUserFromAPI,
  fetchFarcasterUserFollowingFromAPI,
} from './service';
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('farcaster service helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('resolves XMTP address from verifications and verified_addresses', () => {
    const user = { verifications: ['0xabc'], verified_addresses: { eth_addresses: ['0xdef'] } } as any;
    expect(resolveXmtpAddressFromFarcasterUser(user)).toBe('0xabc');
    const noVerifications = { verifications: [], verified_addresses: { eth_addresses: ['0xdef'] } } as any;
    expect(resolveXmtpAddressFromFarcasterUser(noVerifications)).toBe('0xdef');
    expect(resolveXmtpAddressFromFarcasterUser({ verifications: [] } as any)).toBeNull();
  });

  it('skips Farcaster API fetch when base is missing and handles 404', async () => {
    vi.stubEnv('VITE_FARCASTER_API_BASE', '');
    const noBase = await fetchFarcasterUserFromAPI(1);
    expect(noBase).toBeNull();

    vi.stubEnv('VITE_FARCASTER_API_BASE', 'https://fc.example.com');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ fid: 2 }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const notFound = await fetchFarcasterUserFromAPI('missing');
    expect(notFound).toBeNull();
    const following = await fetchFarcasterUserFollowingFromAPI(123);
    expect(following[0]?.fid).toBe(2);
  });

  it('resolves FID from address via ENS and fallback lookups', async () => {
    vi.stubEnv('VITE_FARCASTER_API_BASE', 'https://fc.example.com');
    vi.doMock('@/lib/utils/ens', () => ({
      resolveENSFromAddress: vi.fn(async () => 'alice.eth'),
      resolveFcastId: vi.fn(async () => null),
      resolveBaseEthName: vi.fn(async () => null),
    }));
    const fetchMock = vi
      .fn()
      // by ENS username
      .mockResolvedValueOnce(new Response(JSON.stringify({ fid: 42 }), { status: 200 }))
      // address lookup
      .mockResolvedValueOnce(new Response(JSON.stringify({ fid: 99 }), { status: 200 }))
      // without prefix
      .mockResolvedValueOnce(new Response(JSON.stringify({ fid: 101 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const fid = await resolveFidFromAddress('0xabc');
    expect(fid).toBe(42);
  });

  it('uses Neynar verification lookup when an API key is provided', async () => {
    const neynar = await import('./neynar');
    vi.spyOn(neynar, 'fetchNeynarUserByVerification').mockResolvedValueOnce({ fid: 555 } as any);

    const fid = await resolveFidFromAddress('0xabc', 'key');
    expect(fid).toBe(555);
  });

  it('resolves contact name with ENS, fcast.id, and base.eth priority', async () => {
    const user = { display_name: 'Display', username: 'user' } as any;
    const mockEns = {
      resolveENSFromAddress: vi.fn<() => Promise<string | null>>(async () => null),
      resolveFcastId: vi.fn<() => Promise<string | null>>(async () => null),
      resolveBaseEthName: vi.fn<() => Promise<string | null>>(async () => null),
    };
    vi.doMock('@/lib/utils/ens', () => mockEns);

    let result = await resolveContactName(user, '0xabc');
    expect(result.preferredName).toBe('user.fcast.id');
    expect(mockEns.resolveFcastId).not.toHaveBeenCalled();

    mockEns.resolveENSFromAddress.mockResolvedValueOnce('alice.eth');
    result = await resolveContactName(user, '0xabc');
    expect(result.preferredName).toBe('alice.eth');

    mockEns.resolveENSFromAddress.mockResolvedValueOnce('charlie.base.eth');
    result = await resolveContactName(user, '0xabc');
    expect(result.preferredName).toBe('user.fcast.id');

    const noUsername = { display_name: 'Display', username: '' } as any;
    mockEns.resolveENSFromAddress.mockResolvedValueOnce('charlie.base.eth');
    mockEns.resolveFcastId.mockResolvedValueOnce(null);
    result = await resolveContactName(noUsername, '0xabc');
    expect(result.preferredName).toBe('charlie.base.eth');
  });
});
