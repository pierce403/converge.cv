/**
 * Push notification module using vapid.party
 */

export {
  VAPID_PARTY_API_BASE,
  VAPID_PARTY_XMTP_PUBLIC_KEY_PATH,
  VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH,
  VAPID_PUBLIC_KEY,
} from './config';

export {
  buildVapidPartyXmtpRegistrationPayload,
  enablePushForCurrentUser,
  isPushEnabled,
  disablePush,
  getPushPermissionStatus,
  normalizeXmtpHmacKeys,
  serializePushSubscription,
  type PushSubscriptionResult,
  type SerializedPushSubscription,
  type VapidPartyXmtpRegistrationPayload,
  type XmtpPushIdentity,
  type XmtpPushTopic,
} from './subscribe';

/**
 * Register the service worker for push notifications.
 * This is called automatically by the app, but can be called manually if needed.
 */
export async function registerServiceWorkerForPush(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Push] Service workers are not supported');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    console.log('[Push] Service worker registered for push');
    return reg;
  } catch (e) {
    console.warn('[Push] Failed to register service worker', e);
    return null;
  }
}
