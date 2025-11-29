import type { FarcasterFollow, FarcasterUser } from './service';

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster';

const getHeaders = (apiKey?: string) => {
  const key = apiKey?.trim();
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(key ? { api_key: key } : {}),
  };
};

export interface NeynarUserResult {
  result?: { user?: FarcasterUser & { score?: { value?: number } | number; power_badge?: boolean } };
  user?: FarcasterUser & { score?: { value?: number } | number; power_badge?: boolean };
}

export interface NeynarFollowingResponse {
  result?: {
    users?: Array<FarcasterFollow & { score?: { value?: number } | number; power_badge?: boolean }>;
    next?: { cursor?: string };
  };
  users?: Array<FarcasterFollow & { score?: { value?: number } | number; power_badge?: boolean }>;
  next?: { cursor?: string };
}

const extractScoreValue = (score: unknown): number | undefined => {
  if (typeof score === 'number') return score;
  if (score && typeof score === 'object' && 'value' in score && typeof (score as { value?: unknown }).value === 'number') {
    return (score as { value: number }).value;
  }
  return undefined;
};

export const mapNeynarUser = (
  user: (FarcasterUser | FarcasterFollow) & { score?: { value?: number } | number; power_badge?: boolean }
) => ({
  ...user,
  score: extractScoreValue(user.score),
  power_badge: user.power_badge ?? (user as FarcasterUser).power_badge,
});

export async function fetchNeynarUserProfile(
  identifier: number | string,
  apiKey?: string
): Promise<(FarcasterUser & { score?: number }) | null> {
  if (!apiKey) return null;
  try {
    const isNumeric = typeof identifier === 'number' || /^\d+$/.test(String(identifier));
    const queryParam = isNumeric ? `fid=${identifier}` : `username=${encodeURIComponent(String(identifier))}`;
    const response = await fetch(`${NEYNAR_BASE}/user?${queryParam}`, {
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      console.warn('[Neynar] Failed to fetch user profile', response.status);
      return null;
    }

    const data = (await response.json()) as NeynarUserResult;
    const user = data.result?.user || (data as { user?: FarcasterUser }).user;
    if (!user) return null;
    return { ...user, score: extractScoreValue((user as { score?: unknown }).score) };
  } catch (error) {
    console.warn('[Neynar] Error fetching user profile', error);
    return null;
  }
}

export async function fetchFarcasterFollowingWithNeynar(
  fid: number,
  apiKey?: string
): Promise<Array<FarcasterFollow & { score?: number; power_badge?: boolean }>> {
  if (!apiKey) return [];
  try {
    const users: Array<FarcasterFollow & { score?: number; power_badge?: boolean }> = [];
    let cursor: string | undefined;
    let guard = 0;

    do {
      const url = new URL(`${NEYNAR_BASE}/user/following`);
      url.searchParams.set('fid', String(fid));
      url.searchParams.set('limit', '150');
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await fetch(url.toString(), { headers: getHeaders(apiKey) });
      if (!response.ok) {
        console.warn('[Neynar] Failed to fetch following', response.status);
        break;
      }

      const payload = (await response.json()) as NeynarFollowingResponse;
      const chunk = payload.result?.users || payload.users || [];
      users.push(...chunk.map(mapNeynarUser));
      cursor = payload.result?.next?.cursor || payload.next?.cursor;
      guard += 1;
    } while (cursor && guard < 10);

    return users;
  } catch (error) {
    console.warn('[Neynar] Error fetching following', error);
    return [];
  }
}
