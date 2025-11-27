/**
 * vapid.party Push Configuration
 * 
 * Push notifications are configured via vapid.party
 */

// vapid.party API key
export const VAPID_PARTY_API_KEY = import.meta.env?.VITE_VAPID_PARTY_API_KEY as string | undefined
  || 'vp_2e0db7d4671fae9d2901efa5ce8fec49619040d2339181ab';

// VAPID public key from vapid.party
export const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined
  || 'BKxwakdVoLv-wLAnJDQqazDTn-09EWYfe-k9ybOEZTIFCGd4cQFgyRcwkbLE3GKTWkS_pWnmVV5m7Tci1m3Jeik';

// vapid.party API base URL
export const VAPID_PARTY_API_BASE = 'https://vapid.party/api';

