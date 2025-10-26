/**
 * Service Worker bridge for app ↔ SW communication
 */

export interface SWMessage {
  type: string;
  payload?: any;
}

export interface SWResponse {
  success: boolean;
  data?: any;
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
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
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
 * Subscribe to push notifications
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  try {
    const permission = await requestNotificationPermission();
    if (!permission) {
      return null;
    }

    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      // In production, you'd use your VAPID public key here
      const vapidPublicKey = 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY';

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
    }

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error);
    return false;
  }
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

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

