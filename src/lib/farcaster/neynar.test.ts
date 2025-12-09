import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchFarcasterFollowingWithNeynar,
  fetchNeynarUserByVerification,
  fetchNeynarUserProfile,
  mapNeynarUser,
} from './neynar';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

afterEach(() => {
  mockFetch.mockReset();
});

describe('neynar helpers', () => {
  it('returns null when api key missing', async () => {
    const res = await fetchNeynarUserProfile('alice', undefined);
    expect(res).toBeNull();
    const following = await fetchFarcasterFollowingWithNeynar(1, undefined);
    expect(following).toEqual([]);
  });

  it('maps score value and power badge', () => {
    const mapped = mapNeynarUser({
      fid: 1,
      custody_address: '0x',
      username: 'a',
      display_name: 'a',
      pfp_url: '',
      profile: { bio: { text: '' } },
      verifications: [],
      score: { value: 10 },
      power_badge: true,
    });
    expect(mapped.score).toBe(10);
    expect(mapped.power_badge).toBe(true);
  });

  it('handles non-ok responses gracefully', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    const res = await fetchNeynarUserProfile('alice', 'key');
    expect(res).toBeNull();
  });

  it('looks up users by verification address', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            users: [
              {
                fid: 5,
                custody_address: '',
                username: 'c',
                display_name: 'c',
                pfp_url: '',
                profile: { bio: { text: '' } },
                verifications: ['0x1'],
                score: { value: 7 },
                power_badge: true,
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const user = await fetchNeynarUserByVerification('0x1', 'key');
    expect(user?.fid).toBe(5);
    expect(user?.score).toBe(7);
    expect(user?.power_badge).toBe(true);
  });

  it('paginates following list until cursor ends or guard trips', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              users: [
                {
                  object: 'follow',
                  user: {
                    fid: 1,
                    custody_address: '',
                    username: 'a',
                    display_name: 'a',
                    pfp_url: '',
                    profile: { bio: { text: '' } },
                    verifications: [],
                    score: 5,
                  },
                },
              ],
              next: { cursor: 'next' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              users: [
                {
                  object: 'follow',
                  user: {
                    fid: 2,
                    custody_address: '',
                    username: 'b',
                    display_name: 'b',
                    pfp_url: '',
                    profile: { bio: { text: '' } },
                    verifications: [],
                    power_badge: true,
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const users = await fetchFarcasterFollowingWithNeynar(123, 'key');
    expect(users).toHaveLength(2);
    expect(users[0].score).toBe(5);
    expect(users[1].power_badge).toBe(true);
    expect(users[0].fid).toBe(1);
    expect(users[1].fid).toBe(2);
  });
});
