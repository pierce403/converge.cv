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

const shouldRetryStatus = (status: number): boolean =>
  status === 429 || status === 502 || status === 503 || status === 504;

const parseRetryAfterMs = (response: Response): number | undefined => {
  const raw = response.headers.get('retry-after') || response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.max(0, Math.round(seconds * 1000)));
  }
  return undefined;
};

const isVitest = () =>
  typeof process !== 'undefined' &&
  Boolean((process.env as Record<string, string | undefined>)?.VITEST);

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  if (isVitest()) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  options?: { maxAttempts?: number }
): Promise<Response> => {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
  let attempt = 0;
  let backoffMs = 400;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(url, init);
      if (!response) {
        throw new Error('Fetch returned an empty response');
      }
      if (!shouldRetryStatus(response.status) || attempt >= maxAttempts) {
        return response;
      }
      const retryAfter = parseRetryAfterMs(response);
      const delay = retryAfter ?? Math.min(5000, backoffMs);
      await sleep(delay);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(Math.min(5000, backoffMs));
    }
    backoffMs = Math.min(5000, Math.round(backoffMs * 1.75));
  }

  // Should be unreachable, but TS wants a return.
  return fetch(url, init);
};

const fetchWithFallback = async (path: string, apiKey?: string): Promise<Response> => {
  const headers = getHeaders(apiKey);
  const primary = await fetchWithRetry(`${NEYNAR_BASE}${path}`, { headers });
  if (primary.status !== 404) return primary;
  return fetchWithRetry(`${NEYNAR_FALLBACK_BASE}${path}`, { headers });
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

export interface NeynarUserBulkResponse {
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
    // Use /user/bulk for FIDs and /user/by_username for usernames
    const path = isNumeric
      ? `/user/bulk?fids=${identifier}`
      : `/user/by_username?username=${encodeURIComponent(String(identifier))}`;

    const response = await fetchWithFallback(path, apiKey);

    if (!response.ok) {
      console.warn('[Neynar] Failed to fetch user profile', response.status);
      return null;
    }

    const data = (await response.json()) as NeynarUserResult & { users?: FarcasterUser[] };
    // /user/bulk returns { users: [...] }, /user/by_username returns { user: ... }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = data.result?.user || (data as { user?: FarcasterUser }).user || (data as any).users?.[0] || (data.result as any)?.users?.[0];

    if (!user) return null;
    return { ...user, score: extractScoreValue((user as { score?: unknown }).score) };
  } catch (error) {
    console.warn('[Neynar] Error fetching user profile', error);
    return null;
  }
}

export async function fetchNeynarUsersBulk(
  fids: number[],
  apiKey?: string
): Promise<Array<FarcasterUser & { score?: number; power_badge?: boolean }>> {
  if (!apiKey) return [];

  const unique = Array.from(
    new Set(
      (Array.isArray(fids) ? fids : [])
        .map((fid) => Number(fid))
        .filter((fid) => Number.isFinite(fid) && fid > 0)
    )
  );
  if (unique.length === 0) {
    return [];
  }

  const results: Array<FarcasterUser & { score?: number; power_badge?: boolean }> = [];
  const chunkSize = 100;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const response = await fetchWithFallback(`/user/bulk?fids=${chunk.join(',')}`, apiKey);
      if (!response.ok) {
        console.warn('[Neynar] Failed to fetch bulk users', response.status);
        continue;
      }

      const data = (await response.json()) as NeynarUserBulkResponse & { result?: { users?: FarcasterUser[] } };
      // /user/bulk returns { users: [...] } (sometimes wrapped in { result: { users: [...] } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = data.result?.users || (data as any).users || [];
      results.push(...users.map(mapNeynarUser));
    } catch (error) {
      console.warn('[Neynar] Error fetching bulk users', error);
    }
  }

  return results;
}

export async function fetchNeynarUserByVerification(
  address: string,
  apiKey?: string
): Promise<(FarcasterUser & { score?: number; power_badge?: boolean }) | null> {
  if (!apiKey) return null;
  const trimmed = address?.trim();
  if (!trimmed) return null;
  try {
    // Correct V2 endpoint is bulk-by-address
    const url = new URL(`https://api.neynar.com/v2/farcaster/user/bulk-by-address`);
    url.searchParams.set('addresses', trimmed.toLowerCase());

    // We can't easily use fetchWithFallback cleanly with full URLs, but since we know the endpoint...
    // Let's manually construct the path to use fetchWithFallback which expects a relative path
    const relativePath = `/user/bulk-by-address?addresses=${encodeURIComponent(trimmed.toLowerCase())}`;

    const response = await fetchWithFallback(relativePath, apiKey);
    if (!response.ok) {
      console.warn('[Neynar] Failed to fetch user by verification', response.status);
      return null;
    }

    // Neynar's response shape for "bulk-by-address" has varied across versions:
    // - v2: { "0x...": [ { ...user... } ] }
    // - some wrappers: { result: { users: [...] } }
    const data = (await response.json()) as unknown;

    const pickFirstUser = (input: unknown): FarcasterUser | undefined => {
      if (!input) return undefined;

      // Wrapper shape: { result: { users: [...] } } or { users: [...] }
      if (typeof input === 'object') {
        const wrapped = input as NeynarUsersByVerificationResponse;
        const users = wrapped.result?.users ?? wrapped.users;
        if (Array.isArray(users) && users.length > 0) {
          return users[0];
        }
      }

      // Map shape: { "0x...": [ { ...user... } ] }
      if (typeof input === 'object') {
        const values = Object.values(input as Record<string, unknown>);
        const first = values[0];
        if (Array.isArray(first) && first.length > 0) {
          return first[0] as FarcasterUser;
        }

        // Rare nesting: { "0x...": { result: { users: [...] } } }
        if (first && typeof first === 'object') {
          const nested = pickFirstUser(first);
          if (nested) return nested;
        }
      }

      return undefined;
    };

    const user = pickFirstUser(data);
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
    const response = await fetchWithFallback(`/user/by_username?username=${encodeURIComponent(trimmed)}`, apiKey);
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
