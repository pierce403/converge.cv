import type { FarcasterFollow, FarcasterUser } from './service';

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster';
const NEYNAR_FALLBACK_BASE = 'https://api.neynar.com/farcaster';

const getHeaders = (apiKey?: string) => {
  const key = apiKey?.trim();
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(key ? { api_key: key, 'X-API-KEY': key } : {}),
  };
};

const fetchWithFallback = async (path: string, apiKey?: string): Promise<Response> => {
  const headers = getHeaders(apiKey);
  const primary = await fetch(`${NEYNAR_BASE}${path}`, { headers });
  if (primary.status !== 404) return primary;
  return fetch(`${NEYNAR_FALLBACK_BASE}${path}`, { headers });
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

export interface NeynarUsersByVerificationResponse {
  result?: {
    users?: Array<FarcasterUser & { score?: { value?: number } | number; power_badge?: boolean }>;
  };
  users?: Array<FarcasterUser & { score?: { value?: number } | number; power_badge?: boolean }>;
}

const extractScoreValue = (score: unknown): number | undefined => {
  if (typeof score === 'number') return score;
  if (score && typeof score === 'object' && 'value' in score && typeof (score as { value?: unknown }).value === 'number') {
    return (score as { value: number }).value;
  }
  return undefined;
};

const unwrapUser = (
  entry: (FarcasterUser | FarcasterFollow | { user?: FarcasterUser }) & {
    score?: { value?: number } | number;
    power_badge?: boolean;
  }
): (FarcasterUser & { score?: number; power_badge?: boolean }) => {
  const user = (entry as { user?: FarcasterUser }).user ?? entry;
  return {
    ...(user as FarcasterUser),
    score: extractScoreValue((user as { score?: unknown }).score ?? entry.score),
    power_badge: user.power_badge ?? entry.power_badge,
  };
};

export const mapNeynarUser = (
  user: (FarcasterUser | FarcasterFollow) & { score?: { value?: number } | number; power_badge?: boolean }
) => unwrapUser(user);

export async function fetchNeynarUserProfile(
  identifier: number | string,
  apiKey?: string
): Promise<(FarcasterUser & { score?: number }) | null> {
  if (!apiKey) return null;
  try {
    const isNumeric = typeof identifier === 'number' || /^\d+$/.test(String(identifier));
    const queryParam = isNumeric ? `fid=${identifier}` : `username=${encodeURIComponent(String(identifier))}`;
    const response = await fetchWithFallback(`/user?${queryParam}`, apiKey);

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

export async function fetchNeynarUserByVerification(
  address: string,
  apiKey?: string
): Promise<(FarcasterUser & { score?: number; power_badge?: boolean }) | null> {
  if (!apiKey) return null;
  const trimmed = address?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(`/user/by-verifications`, NEYNAR_BASE);
    url.searchParams.set('verifications', trimmed.toLowerCase());
    url.searchParams.set('limit', '1');

    const response = await fetchWithFallback(url.pathname + url.search, apiKey);
    if (!response.ok) {
      console.warn('[Neynar] Failed to fetch user by verification', response.status);
      return null;
    }

    const data = (await response.json()) as NeynarUsersByVerificationResponse;
    const user = data.result?.users?.[0] || data.users?.[0];
    return user ? mapNeynarUser(user) : null;
  } catch (error) {
    console.warn('[Neynar] Error fetching user by verification', error);
    return null;
  }
}

export async function fetchNeynarUserByIdentifier(
  identifier: number | string,
  apiKey?: string
): Promise<(FarcasterUser & { score?: number; power_badge?: boolean }) | null> {
  if (!apiKey) return null;

  const trimmed = String(identifier).trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed);

  // Prefer verification lookups when possible
  if (isAddress) {
    const byVerification = await fetchNeynarUserByVerification(trimmed, apiKey);
    if (byVerification) return byVerification;
  }

  try {
    const response = await fetch(`${NEYNAR_BASE}/user?username=${encodeURIComponent(trimmed)}`, {
      headers: getHeaders(apiKey),
    });
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn('[Neynar] Failed to fetch user by identifier', response.status);
      }
      return null;
    }
    const data = (await response.json()) as NeynarUserResult;
    const user = data.result?.user || (data as { user?: FarcasterUser }).user;
    return user ? mapNeynarUser(user) : null;
  } catch (error) {
    console.warn('[Neynar] Error fetching user by identifier', error);
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
      const url = new URL(`/following`, NEYNAR_BASE);
      url.searchParams.set('fid', String(fid));
      // Neynar caps limit at 100; keep below to avoid 400 errors.
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await fetchWithFallback(url.pathname + url.search, apiKey);
      if (!response.ok) {
        let body: string | undefined;
        try {
          body = await response.text();
        } catch {
          // ignore
        }
        const message = `[Neynar] Failed to fetch following (${response.status})${body ? `: ${body.slice(0, 120)}` : ''}`;
        console.warn(message);
        throw new Error(message);
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
    throw error;
  }
}
