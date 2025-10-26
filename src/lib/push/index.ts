/**
 * Push notification utilities
 */

import {
  subscribeToPush,
  unsubscribeFromPush,
  isPushSupported,
  getNotificationPermission,
  updateBadge,
} from '@/lib/sw-bridge';

export interface PushPreferences {
  enabled: boolean;
  showPreviews: boolean;
  sound: boolean;
}

const PUSH_PREFS_KEY = 'converge_push_prefs';

/**
 * Get push notification preferences
 */
export function getPushPreferences(): PushPreferences {
  try {
    const stored = localStorage.getItem(PUSH_PREFS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load push preferences:', error);
  }

  return {
    enabled: false,
    showPreviews: true,
    sound: true,
  };
}

/**
 * Save push notification preferences
 */
export function savePushPreferences(prefs: PushPreferences): void {
  try {
    localStorage.setItem(PUSH_PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Failed to save push preferences:', error);
  }
}

/**
 * Enable push notifications
 */
export async function enablePushNotifications(): Promise<boolean> {
  if (!isPushSupported()) {
    return false;
  }

  const subscription = await subscribeToPush();

  if (subscription) {
    const prefs = getPushPreferences();
    prefs.enabled = true;
    savePushPreferences(prefs);

    // TODO: Send subscription to your backend server
    // await sendSubscriptionToServer(subscription);

    return true;
  }

  return false;
}

/**
 * Disable push notifications
 */
export async function disablePushNotifications(): Promise<boolean> {
  const success = await unsubscribeFromPush();

  if (success) {
    const prefs = getPushPreferences();
    prefs.enabled = false;
    savePushPreferences(prefs);

    // TODO: Remove subscription from your backend server
    // await removeSubscriptionFromServer();

    return true;
  }

  return false;
}

/**
 * Check if push is enabled
 */
export function isPushEnabled(): boolean {
  const prefs = getPushPreferences();
  return prefs.enabled && getNotificationPermission() === 'granted';
}

/**
 * Update unread badge on app icon
 */
export async function updateUnreadBadge(count: number): Promise<void> {
  await updateBadge(count);
}

export { isPushSupported, getNotificationPermission };

