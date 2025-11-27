/**
 * vapid.party Push Configuration
 * 
 * To enable push notifications:
 * 1. Get your API key from vapid.party dashboard
 * 2. Set it below or via VITE_VAPID_PARTY_API_KEY env var
 */

// vapid.party API key - set this to enable push notifications
// You can also use VITE_VAPID_PARTY_API_KEY environment variable
export const VAPID_PARTY_API_KEY = import.meta.env?.VITE_VAPID_PARTY_API_KEY as string | undefined;

// Optional: static VAPID public key from vapid.party
// If not set, we'll fetch it dynamically from the API
export const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined;

// vapid.party API base URL
export const VAPID_PARTY_API_BASE = 'https://vapid.party/api';

