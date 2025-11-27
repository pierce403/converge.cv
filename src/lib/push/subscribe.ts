/**
 * Push notification subscription helpers using vapid.party
 * 
 * Flow:
 * 1. Get VAPID public key (static or from API)
 * 2. Subscribe with browser's PushManager
 * 3. POST subscription to vapid.party /api/subscribe
 */

import { VAPID_PARTY_API_KEY, VAPID_PUBLIC_KEY, VAPID_PARTY_API_BASE } from './config';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getVapidPublicKey(): Promise<string> {
  // Option A: use the static key from config if set
  if (VAPID_PUBLIC_KEY && VAPID_PUBLIC_KEY.length > 10) {
    return VAPID_PUBLIC_KEY;
  }

  // Option B: fetch from vapid.party
  if (!VAPID_PARTY_API_KEY) {
    throw new Error('VAPID_PARTY_API_KEY is not configured');
  }

  const res = await fetch(`${VAPID_PARTY_API_BASE}/vapid/public-key`, {
    headers: { 'X-API-Key': VAPID_PARTY_API_KEY }
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch VAPID public key: ${res.status}`);
  }
  
  const json = await res.json();
  return json.data?.publicKey || json.publicKey;
}

export type PushSubscriptionResult = {
  success: boolean;
  endpoint?: string;
  error?: string;
};

/**
 * Enable push notifications for the current user.
 * 
 * @param opts.userId - User identifier for targeting (e.g., inboxId)
 * @param opts.channelId - Channel for grouping subscriptions (default: 'default')
 */
export async function enablePushForCurrentUser(opts?: {
  userId?: string;
  channelId?: string;
}): Promise<PushSubscriptionResult> {
  // Check browser support
  if (!('Notification' in window)) {
    return { success: false, error: 'Notifications not supported in this browser' };
  }
  if (!('serviceWorker' in navigator)) {
    return { success: false, error: 'Service workers not supported in this browser' };
  }
  if (!('PushManager' in window)) {
    return { success: false, error: 'Push notifications not supported in this browser' };
  }

  // Check API key
  if (!VAPID_PARTY_API_KEY) {
    return { success: false, error: 'Push notifications not configured (missing API key)' };
  }

  try {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: `Notification permission ${permission}` };
    }

    // Ensure service worker is ready
    const registration = await navigator.serviceWorker.ready;

    // Get VAPID public key
    const publicKey = await getVapidPublicKey();

    // Subscribe with PushManager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
    });

    // Extract keys for vapid.party
    const p256dhKey = subscription.getKey('p256dh');
    const authKey = subscription.getKey('auth');
    
    if (!p256dhKey || !authKey) {
      return { success: false, error: 'Failed to get subscription keys' };
    }

    const p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
    const auth = btoa(String.fromCharCode(...new Uint8Array(authKey)));

    // Register with vapid.party
    const response = await fetch(`${VAPID_PARTY_API_BASE}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': VAPID_PARTY_API_KEY
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userId: opts?.userId ?? 'anon',
        channelId: opts?.channelId ?? 'default'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Push] vapid.party subscribe failed:', errorText);
      return { success: false, error: `Failed to register subscription: ${response.status}` };
    }

    console.log('[Push] ✅ Successfully subscribed to push notifications');
    return { success: true, endpoint: subscription.endpoint };
  } catch (error) {
    console.error('[Push] Failed to enable push notifications:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Check if push notifications are currently enabled
 */
export async function isPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/**
 * Disable push notifications
 */
export async function disablePush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return true;
    
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;
    
    await subscription.unsubscribe();
    console.log('[Push] ✅ Unsubscribed from push notifications');
    return true;
  } catch (error) {
    console.error('[Push] Failed to disable push notifications:', error);
    return false;
  }
}

/**
 * Get push notification permission status
 */
export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

