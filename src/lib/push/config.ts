/**
 * Public vapid.party Push Configuration
 *
 * Converge is a static PWA, so only public VITE_* config belongs here.
 * Do not add vapid.party API keys or other server-side secrets to this file.
 */

const rawApiBase = import.meta.env?.VITE_VAPID_PARTY_API_BASE as string | undefined;

// vapid.party API base URL. Defaults to the hosted public API root.
export const VAPID_PARTY_API_BASE = (rawApiBase?.trim() || 'https://vapid.party/api').replace(/\/+$/, '');

// Logical app scope for XMTP alert registrations. The relay uses this to keep
// Converge registrations separate from future delivery adapters and apps.
export const XMTP_PUSH_APP_ID = 'converge.cv';

// Optional cached/fallback VAPID public key. If absent, Converge asks vapid.party's public XMTP key endpoint.
export const VAPID_PUBLIC_KEY = (import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || undefined;

// Proposed XMTP-aware public contract. See ARCHITECTURE.md.
export const VAPID_PARTY_XMTP_PUBLIC_KEY_PATH = '/xmtp/vapid-public-key';
export const VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH = '/xmtp/subscriptions';
export const VAPID_PARTY_HEALTH_PATH = '/health';
