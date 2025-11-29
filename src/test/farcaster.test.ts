import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateContactAgainstFilters } from '@/lib/farcaster/filters';
import { defaultFarcasterFilters, useFarcasterStore } from '@/lib/stores/farcaster-store';
import { fetchFarcasterFollowingWithNeynar } from '@/lib/farcaster/neynar';
import type { Contact } from '@/lib/stores/contact-store';

afterEach(() => {
  useFarcasterStore.setState({
    userNeynarApiKey: undefined,
    defaultNeynarApiKey: undefined,
    filters: { ...defaultFarcasterFilters },
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('evaluateContactAgainstFilters', () => {
  it('passes when filters disabled', () => {
    const contact = { farcasterScore: 10 } as Contact;
    const result = evaluateContactAgainstFilters(contact, { ...defaultFarcasterFilters, enabled: false });
    expect(result.passes).toBe(true);
  });

  it('fails when score below threshold', () => {
    const contact = { farcasterScore: 10, farcasterFollowerCount: 500 } as Contact;
    const result = evaluateContactAgainstFilters(contact, {
      ...defaultFarcasterFilters,
      enabled: true,
      minScore: 50,
    });
    expect(result.passes).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('score'))).toBe(true);
  });

  it('requires Farcaster identity when configured', () => {
    const contact = { name: 'No FC' } as Contact;
    const result = evaluateContactAgainstFilters(contact, {
      ...defaultFarcasterFilters,
      enabled: true,
      requireFarcasterIdentity: true,
    });
    expect(result.passes).toBe(false);
  });
});

describe('useFarcasterStore effective key', () => {
  it('prefers user-specified key over default', () => {
    useFarcasterStore.setState({
      userNeynarApiKey: undefined,
      defaultNeynarApiKey: 'default-key',
      filters: { ...defaultFarcasterFilters },
    });
    expect(useFarcasterStore.getState().getEffectiveNeynarApiKey()).toBe('default-key');
    useFarcasterStore.getState().setUserNeynarApiKey('custom-key');
    expect(useFarcasterStore.getState().getEffectiveNeynarApiKey()).toBe('custom-key');
  });
});

describe('fetchFarcasterFollowingWithNeynar', () => {
  it('uses Neynar headers and maps score', async () => {
    const payload = {
      result: {
        users: [
          {
            fid: 1,
            username: 'alice',
            verifications: ['0xabc'],
            score: { value: 42 },
            follower_count: 10,
          },
        ],
      },
    };

    const mockFetch = vi.fn(async (...args) => {
      const response = new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      // Attach original args for assertion without breaking the Response instance
      (response as unknown as { _requestArgs?: unknown[] })._requestArgs = args;
      return response;
    });

    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    const users = await fetchFarcasterFollowingWithNeynar(2, 'test-key');

    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit | undefined)?.headers).toMatchObject({ api_key: 'test-key' });
    expect(users[0].score).toBe(42);
  });
});
