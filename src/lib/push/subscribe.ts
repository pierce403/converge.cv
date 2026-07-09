/**
 * Push notification subscription helpers using vapid.party's XMTP-aware relay contract.
 *
 * Flow:
 * 1. Register/reuse the service worker.
 * 2. Request notification permission from a user action.
 * 3. Create/reuse a PushSubscription with vapid.party's public VAPID key.
 * 4. Register the Web Push subscription plus XMTP inbox/install/topic HMAC data with vapid.party.
 */

import { useAuthStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import {
  VAPID_PARTY_API_BASE,
  VAPID_PARTY_XMTP_PUBLIC_KEY_PATH,
  VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH,
  VAPID_PUBLIC_KEY,
} from './config';

export type SerializedPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type XmtpPushHmacKey = {
  epoch: string;
  key: string;
};

export type XmtpPushTopic = {
  topic: string;
  hmacKeys: XmtpPushHmacKey[];
};

export type XmtpPushIdentity = {
  inboxId: string;
  installationId: string;
  address?: string;
};

export type VapidPartyXmtpRegistrationPayload = {
  version: 1;
  app: {
    id: 'converge.cv';
    origin?: string;
  };
  identity: XmtpPushIdentity;
  subscription: SerializedPushSubscription;
  xmtp: {
    env: 'production';
    topics: XmtpPushTopic[];
    topicSource: 'conversations.hmacKeys';
  };
  preferences: {
    minimalPayloadOnly: true;
    plaintextPreview: false;
  };
  userAgent?: string;
  registeredAt: string;
};

export type PushSubscriptionResult = {
  success: boolean;
  endpoint?: string;
  registrationId?: string;
  topicCount?: number;
  error?: string;
};

type FetchLike = typeof fetch;

type EnablePushOptions = {
  identity?: Partial<XmtpPushIdentity>;
  topics?: XmtpPushTopic[];
  vapidPublicKey?: string;
  apiBase?: string;
  fetchFn?: FetchLike;
};

type DisablePushOptions = {
  identity?: Partial<XmtpPushIdentity>;
  apiBase?: string;
  fetchFn?: FetchLike;
};

function joinApiPath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const compact = base64.trim();
  const padding = '='.repeat((4 - (compact.length % 4)) % 4);
  const base64Safe = (compact + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unknownToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return new Uint8Array(value);
  }
  return null;
}

function unknownKeyToBase64Url(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  const bytes = unknownToBytes(value);
  return bytes ? bytesToBase64Url(bytes) : null;
}

function unknownEpochToString(value: unknown): string | null {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function normalizeHmacKeyEntries(value: unknown): XmtpPushHmacKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): XmtpPushHmacKey[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const key = unknownKeyToBase64Url(record.key);
    const epoch = unknownEpochToString(record.epoch);
    if (!key || !epoch) {
      return [];
    }
    return [{ epoch, key }];
  });
}

function hmacMapEntries(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) {
    return Array.from(value.entries()).filter(
      (entry): entry is [string, unknown] => typeof entry[0] === 'string',
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry): Array<[string, unknown]> => {
      if (Array.isArray(entry) && typeof entry[0] === 'string') {
        return [[entry[0], entry[1]]];
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (typeof record.topic === 'string') {
          return [[record.topic, record.hmacKeys ?? record.keys]];
        }
      }
      return [];
    });
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>);
  }

  return [];
}

export function normalizeXmtpHmacKeys(value: unknown): XmtpPushTopic[] {
  return hmacMapEntries(value)
    .map(([topic, entries]) => ({
      topic,
      hmacKeys: normalizeHmacKeyEntries(entries),
    }))
    .filter((topic) => topic.topic.trim() && topic.hmacKeys.length > 0);
}

export function serializePushSubscription(subscription: PushSubscription): SerializedPushSubscription {
  const p256dhKey = subscription.getKey('p256dh');
  const authKey = subscription.getKey('auth');

  if (!p256dhKey || !authKey) {
    throw new Error('Failed to get subscription keys');
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: bytesToBase64Url(new Uint8Array(p256dhKey)),
      auth: bytesToBase64Url(new Uint8Array(authKey)),
    },
  };
}

function getOrigin(): string | undefined {
  try {
    return typeof window !== 'undefined' ? window.location.origin : undefined;
  } catch {
    return undefined;
  }
}

function getUserAgent(): string | undefined {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  } catch {
    return undefined;
  }
}

export function buildVapidPartyXmtpRegistrationPayload({
  identity,
  subscription,
  topics,
  registeredAt = new Date().toISOString(),
}: {
  identity: XmtpPushIdentity;
  subscription: SerializedPushSubscription;
  topics: XmtpPushTopic[];
  registeredAt?: string;
}): VapidPartyXmtpRegistrationPayload {
  return {
    version: 1,
    app: {
      id: 'converge.cv',
      origin: getOrigin(),
    },
    identity,
    subscription,
    xmtp: {
      env: 'production',
      topics,
      topicSource: 'conversations.hmacKeys',
    },
    preferences: {
      minimalPayloadOnly: true,
      plaintextPreview: false,
    },
    userAgent: getUserAgent(),
    registeredAt,
  };
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    return existing;
  }

  await navigator.serviceWorker.register('/sw.js');
  return await navigator.serviceWorker.ready;
}

async function getVapidPublicKey({
  apiBase = VAPID_PARTY_API_BASE,
  vapidPublicKey = VAPID_PUBLIC_KEY,
  fetchFn = fetch,
}: {
  apiBase?: string;
  vapidPublicKey?: string;
  fetchFn?: FetchLike;
} = {}): Promise<string> {
  if (vapidPublicKey && vapidPublicKey.length > 10) {
    return vapidPublicKey;
  }

  const response = await fetchFn(joinApiPath(apiBase, VAPID_PARTY_XMTP_PUBLIC_KEY_PATH), {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch vapid.party public VAPID key: ${response.status}. Set VITE_VAPID_PUBLIC_KEY until the public XMTP key endpoint is deployed.`,
    );
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    const key = json?.data?.publicKey ?? json?.publicKey;
    if (typeof key === 'string' && key.trim()) {
      return key.trim();
    }
  } else {
    const text = (await response.text()).trim();
    if (text) {
      return text;
    }
  }

  throw new Error('vapid.party public VAPID key response did not include a publicKey');
}

async function collectCurrentIdentity(override?: Partial<XmtpPushIdentity>): Promise<XmtpPushIdentity> {
  if (override?.inboxId && override.installationId) {
    return {
      inboxId: override.inboxId,
      installationId: override.installationId,
      address: override.address,
    };
  }

  const xmtp = getXmtpClient();
  const storedIdentity = useAuthStore.getState().identity;

  const inboxId = override?.inboxId ?? xmtp.getInboxId() ?? storedIdentity?.inboxId;
  const installationId =
    override?.installationId ?? xmtp.getInstallationId() ?? storedIdentity?.installationId;
  const address = override?.address ?? xmtp.getAddress() ?? storedIdentity?.address;

  if (!inboxId) {
    throw new Error('XMTP inbox ID is required before enabling notifications');
  }
  if (!installationId) {
    throw new Error('XMTP installation ID is required before enabling notifications');
  }

  return {
    inboxId,
    installationId,
    address,
  };
}

async function collectCurrentTopics(override?: XmtpPushTopic[]): Promise<XmtpPushTopic[]> {
  if (override) {
    return override;
  }

  const xmtp = getXmtpClient();
  const hmacKeys = await xmtp.getPushHmacKeys();
  return normalizeXmtpHmacKeys(hmacKeys);
}

async function registerWithVapidParty(
  payload: VapidPartyXmtpRegistrationPayload,
  {
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
  }: {
    apiBase?: string;
    fetchFn?: FetchLike;
  } = {},
): Promise<{ registrationId?: string }> {
  const response = await fetchFn(joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const suffix = errorText ? `: ${errorText}` : '';
    throw new Error(`vapid.party XMTP registration failed: ${response.status}${suffix}`);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }

  const json = await response.json();
  const registrationId = json?.data?.id ?? json?.id;
  return typeof registrationId === 'string' ? { registrationId } : {};
}

async function unregisterWithVapidParty(
  endpoint: string,
  {
    identity,
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
  }: {
    identity?: Partial<XmtpPushIdentity>;
    apiBase?: string;
    fetchFn?: FetchLike;
  } = {},
): Promise<void> {
  const resolvedIdentity = await collectCurrentIdentity(identity).catch(() => undefined);
  await fetchFn(joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: 1,
      app: { id: 'converge.cv', origin: getOrigin() },
      endpoint,
      identity: resolvedIdentity,
      deletedAt: new Date().toISOString(),
    }),
  }).catch((error) => {
    console.warn('[Push] vapid.party unsubscribe failed; removing local subscription anyway', error);
  });
}

/**
 * Enable push notifications for the current XMTP identity.
 */
export async function enablePushForCurrentUser(opts: EnablePushOptions = {}): Promise<PushSubscriptionResult> {
  if (!('Notification' in window)) {
    return { success: false, error: 'Notifications not supported in this browser' };
  }
  if (!('serviceWorker' in navigator)) {
    return { success: false, error: 'Service workers not supported in this browser' };
  }
  if (!('PushManager' in window)) {
    return { success: false, error: 'Push notifications not supported in this browser' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: `Notification permission ${permission}` };
    }

    const identity = await collectCurrentIdentity(opts.identity);
    const topics = await collectCurrentTopics(opts.topics);
    const registration = await ensureServiceWorkerRegistration();
    const publicKey = await getVapidPublicKey({
      apiBase: opts.apiBase,
      vapidPublicKey: opts.vapidPublicKey,
      fetchFn: opts.fetchFn,
    });

    const existingSubscription = await registration.pushManager.getSubscription();
    let createdSubscription = false;
    const subscription =
      existingSubscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));
    createdSubscription = !existingSubscription;

    const serializedSubscription = serializePushSubscription(subscription);
    const payload = buildVapidPartyXmtpRegistrationPayload({
      identity,
      subscription: serializedSubscription,
      topics,
    });

    try {
      const registered = await registerWithVapidParty(payload, {
        apiBase: opts.apiBase,
        fetchFn: opts.fetchFn,
      });

      console.log('[Push] Successfully registered XMTP push subscription with vapid.party');
      return {
        success: true,
        endpoint: subscription.endpoint,
        registrationId: registered.registrationId,
        topicCount: topics.length,
      };
    } catch (error) {
      if (createdSubscription) {
        await subscription.unsubscribe().catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    console.error('[Push] Failed to enable push notifications:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if push notifications are currently enabled locally.
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
 * Disable push notifications locally and best-effort unregister with vapid.party.
 */
export async function disablePush(opts: DisablePushOptions = {}): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return true;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    await unregisterWithVapidParty(subscription.endpoint, opts);
    await subscription.unsubscribe();
    console.log('[Push] Unsubscribed from push notifications');
    return true;
  } catch (error) {
    console.error('[Push] Failed to disable push notifications:', error);
    return false;
  }
}

/**
 * Get push notification permission status.
 */
export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}
