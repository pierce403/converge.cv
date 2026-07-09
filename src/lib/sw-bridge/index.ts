/**
 * Service Worker bridge for app ↔ SW communication
 */

import { disablePush, enablePushForCurrentUser } from '@/lib/push';

export interface SWMessage {
  type: string;
  payload?: unknown;
}

export interface SWResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Send a message to the service worker
 */
export async function sendToServiceWorker(message: SWMessage): Promise<SWResponse> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return { success: false, error: 'Service worker not available' };
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event) => {
      resolve(event.data);
    };

    navigator.serviceWorker.controller?.postMessage(message, [channel.port2]);

    // Timeout after 5 seconds
    setTimeout(() => {
      resolve({ success: false, error: 'Service worker timeout' });
    }, 5000);
  });
}

/**
 * Update badge count on app icon
 */
export async function updateBadge(count: number): Promise<void> {
  if ('setAppBadge' in navigator) {
    try {
      if (count > 0) {
        await (navigator as Navigator & { setAppBadge: (count: number) => Promise<void> }).setAppBadge(count);
      } else {
        await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
      }
    } catch (error) {
      console.error('Failed to update badge:', error);
    }
  }
}

/**
 * Request push notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

/**
 * Subscribe to push notifications.
 *
 * @deprecated Use `enablePushForCurrentUser` from `@/lib/push` for new code.
 * This compatibility shim delegates to the canonical vapid.party/XMTP flow.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  try {
    const result = await enablePushForCurrentUser();
    if (!result.success) {
      return null;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 *
 * @deprecated Use `disablePush` from `@/lib/push` for new code.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  return disablePush();
}

/**
 * Check if push notifications are supported and permitted
 */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if ('Notification' in window) {
    return Notification.permission;
  }
  return 'denied';
}

