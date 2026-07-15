/**
 * Push notification module using vapid.party
 */

import { ensurePushServiceWorkerRegistration } from './subscribe';

export {
  XMTP_PUSH_APP_ID,
  VAPID_PARTY_API_BASE,
  VAPID_PARTY_HEALTH_PATH,
  VAPID_PARTY_XMTP_PUBLIC_KEY_PATH,
  VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH,
  VAPID_PUBLIC_KEY,
} from './config';

export {
  buildXmtpAlertRegistrationPayload,
  buildXmtpAlertUnregistrationPayload,
  buildVapidPartyXmtpRegistrationPayload,
  cacheInboxPushRegistration,
  clearPushActivityForInbox,
  enablePushForLoadedInboxes,
  enablePushForCurrentUser,
  ensurePushServiceWorkerRegistration,
  getBrowserPushSubscriptionState,
  getAppPushStatus,
  isPushEnabled,
  disablePush,
  getPushPermissionStatus,
  getXmtpPushServiceStatus,
  isPushRegistrationRefreshReady,
  listPendingPushActivity,
  listenForPushActivity,
  listenForPushActivityCleared,
  listenForPushRegistrationChanged,
  normalizeXmtpGroupTopic,
  normalizeXmtpHmacKeys,
  normalizeXmtpPushTopics,
  preparePushBrowserResources,
  refreshPushRegistrationForCurrentInbox,
  refreshPushRegistrationForInbox,
  removeInboxPushRegistration,
  removePushRegistrationForInbox,
  serializePushSubscription,
  updatePushInboxProfile,
  type AppPushStatus,
  type BrowserPushSubscriptionState,
  type DisablePushOptions,
  type EnablePushOptions,
  type InboxPushRegistrationInput,
  type PendingInboxActivity,
  type PushRuntimeOptions,
  type PushRegistrationSyncState,
  type PushSubscriptionResult,
  type SerializedPushSubscription,
  type XmtpAlertRegistrationPayload,
  type XmtpAlertUnregistrationPayload,
  type XmtpPushDeliveryReadiness,
  type XmtpPushServiceStatus,
  type VapidPartyXmtpRegistrationPayload,
  type XmtpPushIdentity,
  type XmtpPushTopic,
} from './subscribe';

export {
  BrowserPushStateStore,
  MemoryPushStateStore,
  getPushStateStore,
  pushRegistrationKey,
  type CachedInboxPushRegistration,
  type PushActivityHint,
  type PushDiagnosticReceipt,
  type PushInboxProfile,
  type PushPreferenceState,
  type PushRelayDiagnosticsCapability,
  type PushStateStore,
} from './state';

export {
  currentRelayDiagnosticRegistration,
  getPushDiagnosticSnapshot,
  getRelayPushRegistrationStatus,
  listenForPushDiagnosticReceipt,
  sendRelayPushDiagnosticTest,
  testLocalPushNotificationDisplay,
  waitForRelayPushDiagnosticReceipt,
  type InboxPushDiagnostic,
  type PushDiagnosticSnapshot,
  type PushDiagnosticTestResult,
  type RelayRegistrationDiagnostic,
} from './diagnostics';

export {
  pushRegistrationRefreshCooldownKey,
  type PushBuildIdentity,
} from './bootstrap';

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
    const reg = await ensurePushServiceWorkerRegistration();
    console.log('[Push] Service worker registered for push');
    return reg;
  } catch (e) {
    console.warn('[Push] Failed to register service worker', e);
    return null;
  }
}
