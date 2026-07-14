/**
 * App-level Web Push registration for Converge.
 *
 * A browser owns one PushSubscription. The relay owns one logical record for
 * each loaded XMTP inbox/installation. Inactive inboxes are re-registered from
 * cached topic material; this module never opens or syncs an inactive XMTP
 * client.
 */

import { useAuthStore, useInboxRegistryStore } from '@/lib/stores';
import { normalizeInboxId } from '@/lib/utils/inbox';
import { getXmtpClient } from '@/lib/xmtp';
import {
  getPushStateStore,
  pushRegistrationKey,
  type CachedInboxPushRegistration,
  type PushStateStore,
} from './state';
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

export type InboxPushRegistrationInput = {
  identity: XmtpPushIdentity;
  topics: XmtpPushTopic[];
  displayName?: string;
  inboxHandle?: string;
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
  notification: {
    inboxHandle: string;
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
  registrationIds?: string[];
  topicCount?: number;
  registeredInboxCount?: number;
  failedInboxIds?: string[];
  error?: string;
};

export type AppPushStatus = {
  state: 'unsupported' | 'disabled' | 'partial' | 'enabled';
  enabledPreference: boolean;
  hasBrowserSubscription: boolean;
  endpoint?: string;
  registeredInboxCount: number;
  expectedInboxCount: number;
  missingInboxIds: string[];
  pendingDeletionCount: number;
};

export type PendingInboxActivity = {
  inboxHandle: string;
  inboxId?: string;
  displayName?: string;
  receivedAt: number;
  count: number;
};

export type PushRegistrationSyncState = {
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  syncStatus: 'idle' | 'syncing-conversations' | 'syncing-messages' | 'complete';
  lastConnected: number | null;
  lastSyncedAt: number | null;
};

type FetchLike = typeof fetch;
const PUSH_ACTIVITY_CLEARED_EVENT = 'converge.push.activity-cleared';
const PUSH_REGISTRATION_CHANGED_EVENT = 'converge.push.registration-changed';
const XMTP_GROUP_ID_PATTERN = /^[0-9a-f]{64}$/i;
const XMTP_GROUP_TOPIC_PATTERN = /^\/xmtp\/mls\/1\/g-([0-9a-f]{64})\/proto$/i;
const DEFAULT_RELAY_REQUEST_TIMEOUT_MS = 5_000;
const BROWSER_PUSH_PROVIDER_RETRY_DELAYS_MS = [250, 750] as const;
const invalidatedPushRegistrationKeys = new Set<string>();
const activeRelayRequestControllers = new Set<AbortController>();
let pushMutationTail: Promise<void> = Promise.resolve();
let pushMutationGeneration = 0;

export type PushRuntimeOptions = {
  apiBase?: string;
  fetchFn?: FetchLike;
  stateStore?: PushStateStore;
  requestTimeoutMs?: number;
};

export type EnablePushOptions = PushRuntimeOptions & {
  identity?: Partial<XmtpPushIdentity>;
  topics?: XmtpPushTopic[];
  displayName?: string;
  loadedInboxIds?: string[];
  registrations?: InboxPushRegistrationInput[];
  vapidPublicKey?: string;
  permissionPromise?: Promise<NotificationPermission>;
  browserResourcesPromise?: Promise<PushBrowserResources>;
  browserSubscriptionPromise?: Promise<PushBrowserSubscription>;
  mutationGeneration?: number;
};

export type DisablePushOptions = PushRuntimeOptions & {
  identity?: Partial<XmtpPushIdentity>;
};

type QueuedPushRefreshRequest = {
  input: InboxPushRegistrationInput;
  opts: PushRuntimeOptions;
  fingerprint: string;
  mutationGeneration: number;
};

type PushRefreshQueue = {
  latest: QueuedPushRefreshRequest;
  revision: number;
  promise: Promise<PushSubscriptionResult>;
};

const pushRefreshQueues = new Map<string, PushRefreshQueue>();

function serializePushMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pushMutationTail.then(operation, operation);
  pushMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function joinApiPath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchRelayWithTimeout<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error('vapid.party request was cancelled'),
      );
    }, { once: true });
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`vapid.party request timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, Math.max(1, timeoutMs));
  });
  activeRelayRequestControllers.add(controller);
  try {
    return await Promise.race([
      fetchFn(url, { ...init, signal: controller.signal }).then(consume),
      abortPromise,
      timeoutPromise,
    ]);
  } finally {
    activeRelayRequestControllers.delete(controller);
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function supersedePushMutations(): void {
  pushMutationGeneration += 1;
  for (const controller of activeRelayRequestControllers) {
    controller.abort(new Error('Push operation was superseded by a later disable or inbox removal'));
  }
}

export function isPushRegistrationRefreshReady(state: PushRegistrationSyncState): boolean {
  if (state.connectionStatus !== 'connected') return false;
  if (state.syncStatus === 'complete') return true;
  return (
    state.syncStatus === 'idle' &&
    typeof state.lastConnected === 'number' &&
    typeof state.lastSyncedAt === 'number' &&
    state.lastSyncedAt >= state.lastConnected
  );
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
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return new Uint8Array(value);
  }
  return null;
}

function unknownKeyToBase64Url(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const bytes = unknownToBytes(value);
  return bytes ? bytesToBase64Url(bytes) : null;
}

function unknownEpochToString(value: unknown): string | null {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function normalizeHmacKeyEntries(value: unknown): XmtpPushHmacKey[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): XmtpPushHmacKey[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const key = unknownKeyToBase64Url(record.key);
    const epoch = unknownEpochToString(record.epoch);
    return key && epoch ? [{ epoch, key }] : [];
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
      if (Array.isArray(entry) && typeof entry[0] === 'string') return [[entry[0], entry[1]]];
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (typeof record.topic === 'string') return [[record.topic, record.hmacKeys ?? record.keys]];
      }
      return [];
    });
  }
  return value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>)
    : [];
}

export function normalizeXmtpHmacKeys(value: unknown): XmtpPushTopic[] {
  return normalizeGroupTopics(
    hmacMapEntries(value).map(([topic, entries]) => ({
      topic,
      hmacKeys: normalizeHmacKeyEntries(entries),
    })),
  );
}

export function normalizeXmtpGroupTopic(value: string): string | null {
  const candidate = value.trim();
  if (XMTP_GROUP_ID_PATTERN.test(candidate)) {
    return `/xmtp/mls/1/g-${candidate.toLowerCase()}/proto`;
  }
  const match = candidate.match(XMTP_GROUP_TOPIC_PATTERN);
  return match ? `/xmtp/mls/1/g-${match[1].toLowerCase()}/proto` : null;
}

function mergeHmacKeys(target: XmtpPushHmacKey[], source: XmtpPushHmacKey[]): void {
  const seen = new Set(target.map((entry) => `${entry.epoch}\0${entry.key}`));
  for (const entry of source) {
    const epoch = entry.epoch.trim();
    const key = entry.key.trim();
    const fingerprint = `${epoch}\0${key}`;
    if (!epoch || !key || seen.has(fingerprint)) continue;
    target.push({ epoch, key });
    seen.add(fingerprint);
  }
}

function normalizeGroupTopics(topics: XmtpPushTopic[]): XmtpPushTopic[] {
  const byTopic = new Map<string, XmtpPushHmacKey[]>();
  for (const entry of topics) {
    const topic = normalizeXmtpGroupTopic(entry.topic);
    if (!topic) continue;
    const keys = byTopic.get(topic) ?? [];
    mergeHmacKeys(keys, entry.hmacKeys);
    if (keys.length > 0) byTopic.set(topic, keys);
  }
  return Array.from(byTopic, ([topic, hmacKeys]) => ({ topic, hmacKeys }));
}

export function normalizeXmtpPushTopics(
  topics: XmtpPushTopic[],
  installationId: string,
): XmtpPushTopic[] {
  const normalized = normalizeGroupTopics(topics);
  const normalizedInstallationId = normalizeXmtpInstallationId(installationId);
  if (!normalizedInstallationId) {
    throw new Error('XMTP installation ID must be a 32-byte hexadecimal value');
  }
  normalized.push({
    topic: `/xmtp/mls/1/w-${normalizedInstallationId}/proto`,
    hmacKeys: [],
  });
  return normalized;
}

function normalizeXmtpInstallationId(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  const unprefixed = candidate.startsWith('0x') ? candidate.slice(2) : candidate;
  return /^[0-9a-f]{64}$/.test(unprefixed) ? unprefixed : null;
}

export function serializePushSubscription(subscription: PushSubscription): SerializedPushSubscription {
  const p256dhKey = subscription.getKey('p256dh');
  const authKey = subscription.getKey('auth');
  if (!p256dhKey || !authKey) throw new Error('Failed to get subscription keys');
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

function emitPushActivityCleared(inboxId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PUSH_ACTIVITY_CLEARED_EVENT, {
      detail: { inboxId: inboxId ? normalizeInboxId(inboxId) : undefined },
    }),
  );
}

function emitPushRegistrationChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PUSH_REGISTRATION_CHANGED_EVENT));
}

export function listenForPushRegistrationChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PUSH_REGISTRATION_CHANGED_EVENT, callback);
  return () => window.removeEventListener(PUSH_REGISTRATION_CHANGED_EVENT, callback);
}

export function buildVapidPartyXmtpRegistrationPayload({
  identity,
  subscription,
  topics,
  inboxHandle,
  registeredAt = new Date().toISOString(),
}: {
  identity: XmtpPushIdentity;
  subscription: SerializedPushSubscription;
  topics: XmtpPushTopic[];
  inboxHandle?: string;
  registeredAt?: string;
}): VapidPartyXmtpRegistrationPayload {
  return {
    version: 1,
    app: { id: 'converge.cv', origin: getOrigin() },
    identity,
    subscription,
    xmtp: { env: 'production', topics, topicSource: 'conversations.hmacKeys' },
    notification: { inboxHandle: inboxHandle ?? 'legacy-current-inbox' },
    preferences: { minimalPayloadOnly: true, plaintextPreview: false },
    userAgent: getUserAgent(),
    registeredAt,
  };
}

function hasPushSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function getVapidPublicKey({
  apiBase = VAPID_PARTY_API_BASE,
  vapidPublicKey = VAPID_PUBLIC_KEY,
  fetchFn = fetch,
  requestTimeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
}: {
  apiBase?: string;
  vapidPublicKey?: string;
  fetchFn?: FetchLike;
  requestTimeoutMs?: number;
} = {}): Promise<string> {
  if (vapidPublicKey && vapidPublicKey.length > 10) return vapidPublicKey;
  return fetchRelayWithTimeout(
    fetchFn,
    joinApiPath(apiBase, VAPID_PARTY_XMTP_PUBLIC_KEY_PATH),
    { method: 'GET' },
    async (response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to fetch vapid.party public VAPID key: ${response.status}. Set VITE_VAPID_PUBLIC_KEY until the public XMTP key endpoint is deployed.`,
        );
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('application/json')) {
        const json = await response.json();
        const key = json?.data?.publicKey ?? json?.publicKey;
        if (typeof key === 'string' && key.trim()) return key.trim();
      } else {
        const text = (await response.text()).trim();
        if (text) return text;
      }
      throw new Error('vapid.party public VAPID key response did not include a publicKey');
    },
    requestTimeoutMs,
  );
}

type PushBrowserResources = {
  serviceWorker: ServiceWorkerRegistration;
  applicationServerKey: Uint8Array;
};

type PushBrowserSubscription = {
  subscription: PushSubscription;
  created: boolean;
};

let defaultBrowserResourcesPromise: Promise<PushBrowserResources> | null = null;
let browserSubscriptionCreationPromise: Promise<PushBrowserSubscription> | null = null;

class BrowserPushProviderError extends Error {
  constructor() {
    super(
      "The browser's push provider could not create a subscription. vapid.party was not contacted. Check that notifications are allowed for converge.cv and that your browser's push service is available, then retry. In Brave, enable Use Google Services for Push Messaging under Privacy.",
    );
    this.name = 'BrowserPushProviderError';
  }
}

function usesDefaultPushResources(options: EnablePushOptions): boolean {
  return !options.apiBase && !options.fetchFn && !options.vapidPublicKey && !options.requestTimeoutMs;
}

/** Preload the service worker and public key before the user clicks Enable. */
export function preparePushBrowserResources(
  options: Pick<EnablePushOptions, 'apiBase' | 'fetchFn' | 'vapidPublicKey' | 'requestTimeoutMs'> = {},
): Promise<PushBrowserResources> {
  if (!hasPushSupport()) {
    return Promise.reject(new Error('Notifications not supported in this browser'));
  }
  if (usesDefaultPushResources(options) && defaultBrowserResourcesPromise) {
    return defaultBrowserResourcesPromise;
  }

  const promise = Promise.all([
    ensureServiceWorkerRegistration(),
    getVapidPublicKey({
      apiBase: options.apiBase,
      vapidPublicKey: options.vapidPublicKey,
      fetchFn: options.fetchFn,
      requestTimeoutMs: options.requestTimeoutMs,
    }),
  ]).then(([serviceWorker, publicKey]) => {
    let applicationServerKey: Uint8Array;
    try {
      applicationServerKey = urlBase64ToUint8Array(publicKey);
    } catch {
      throw new Error('vapid.party returned an invalid VAPID public key');
    }
    if (applicationServerKey.byteLength !== 65 || applicationServerKey[0] !== 0x04) {
      throw new Error(
        'vapid.party returned an invalid VAPID public key: expected a 65-byte uncompressed P-256 key',
      );
    }
    return { serviceWorker, applicationServerKey };
  });

  if (usesDefaultPushResources(options)) {
    defaultBrowserResourcesPromise = promise;
    void promise.catch(() => {
      if (defaultBrowserResourcesPromise === promise) defaultBrowserResourcesPromise = null;
    });
  }
  return promise;
}

function isBrowserPushProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message).toLowerCase() : '';
  return name === 'AbortError' || message.includes('push service error');
}

function invalidateCachedBrowserResources(resourcesPromise: Promise<PushBrowserResources>): void {
  if (defaultBrowserResourcesPromise === resourcesPromise) {
    defaultBrowserResourcesPromise = null;
  }
}

function waitForBrowserPushProvider(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function applicationServerKeyMatches(
  subscription: PushSubscription,
  expected: Uint8Array,
): boolean {
  const current = unknownToBytes(subscription.options?.applicationServerKey);
  if (!current || current.byteLength !== expected.byteLength) return false;
  return current.every((value, index) => value === expected[index]);
}

async function performCreateBrowserPushSubscription(
  options: EnablePushOptions,
): Promise<PushBrowserSubscription> {
  const permissionPromise = options.permissionPromise ?? Notification.requestPermission();
  const resourcesPromise =
    options.browserResourcesPromise ?? preparePushBrowserResources(options);
  const [permission, resources] = await Promise.all([permissionPromise, resourcesPromise]);
  if (permission !== 'granted') {
    throw new Error(`Notification permission ${permission}`);
  }

  const pushManager = resources.serviceWorker.pushManager;
  let subscription = await pushManager.getSubscription();
  if (subscription && !applicationServerKeyMatches(subscription, resources.applicationServerKey)) {
    const removed = await subscription.unsubscribe();
    if (!removed) throw new Error('The browser could not replace its outdated push subscription');
    subscription = null;
  }
  if (subscription) return { subscription, created: false };

  const subscribe = () =>
    pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: resources.applicationServerKey as BufferSource,
    });

  for (let attempt = 0; ; attempt += 1) {
    try {
      return { subscription: await subscribe(), created: true };
    } catch (error) {
      const recovered = await pushManager.getSubscription().catch(() => null);
      if (recovered && applicationServerKeyMatches(recovered, resources.applicationServerKey)) {
        return { subscription: recovered, created: true };
      }
      if (!isBrowserPushProviderFailure(error)) {
        invalidateCachedBrowserResources(resourcesPromise);
        throw error;
      }

      const retryDelay = BROWSER_PUSH_PROVIDER_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined) {
        invalidateCachedBrowserResources(resourcesPromise);
        throw new BrowserPushProviderError();
      }

      // Chromium can resolve unsubscribe() before its underlying push-provider
      // operation has finished. Give that race a short, bounded backoff.
      await waitForBrowserPushProvider(retryDelay);
      const delayed = await pushManager.getSubscription().catch(() => null);
      if (delayed && applicationServerKeyMatches(delayed, resources.applicationServerKey)) {
        return { subscription: delayed, created: true };
      }
    }
  }
}

function createBrowserPushSubscription(options: EnablePushOptions): Promise<PushBrowserSubscription> {
  if (browserSubscriptionCreationPromise) return browserSubscriptionCreationPromise;

  const promise = performCreateBrowserPushSubscription(options);
  browserSubscriptionCreationPromise = promise;
  void promise.then(
    () => {
      if (browserSubscriptionCreationPromise === promise) browserSubscriptionCreationPromise = null;
    },
    () => {
      if (browserSubscriptionCreationPromise === promise) browserSubscriptionCreationPromise = null;
    },
  );
  return promise;
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
  if (!inboxId) throw new Error('XMTP inbox ID is required before enabling notifications');
  if (!installationId) throw new Error('XMTP installation ID is required before enabling notifications');
  return { inboxId, installationId, address };
}

async function collectCurrentTopics(override?: XmtpPushTopic[]): Promise<XmtpPushTopic[]> {
  if (override) return override;
  return normalizeXmtpHmacKeys(await getXmtpClient().getPushHmacKeys());
}

function currentDisplayName(override?: string): string | undefined {
  const explicit = override?.trim();
  if (explicit) return explicit;
  const identity = useAuthStore.getState().identity;
  const identityName = identity?.displayName?.trim();
  if (identityName) return identityName;
  if (!identity?.inboxId) return undefined;
  const registry = useInboxRegistryStore.getState();
  registry.hydrate();
  const entry = registry.entries.find(
    (candidate) => normalizeInboxId(candidate.inboxId) === normalizeInboxId(identity.inboxId),
  );
  return entry?.displayLabel.trim() || undefined;
}

function createInboxHandle(): string {
  const random = new Uint8Array(18);
  globalThis.crypto.getRandomValues(random);
  return bytesToBase64Url(random);
}

function usableInboxHandle(value: string | undefined, inboxId: string): string | undefined {
  const handle = value?.trim();
  if (!handle || !/^[A-Za-z0-9_-]{8,128}$/.test(handle)) return undefined;
  return handle.toLowerCase() === inboxId.toLowerCase() ? undefined : handle;
}

function normalizeIdentity(identity: XmtpPushIdentity): XmtpPushIdentity {
  const inboxId = normalizeInboxId(identity.inboxId);
  const installationId = normalizeXmtpInstallationId(identity.installationId);
  if (!inboxId) throw new Error('XMTP inbox ID is required for push');
  if (!installationId) {
    throw new Error('XMTP installation ID must be a 32-byte hexadecimal value');
  }
  return {
    inboxId,
    installationId,
    address: identity.address?.trim() || undefined,
  };
}

export async function cacheInboxPushRegistration(
  input: InboxPushRegistrationInput,
  options: { stateStore?: PushStateStore; now?: number } = {},
): Promise<CachedInboxPushRegistration> {
  const store = options.stateStore ?? getPushStateStore();
  const now = options.now ?? Date.now();
  const identity = normalizeIdentity(input.identity);
  const key = pushRegistrationKey(identity);
  const registrations = await store.listRegistrations();
  const existing = registrations.find((entry) => entry.key === key);
  const existingProfile = await store.getProfileByInboxId(identity.inboxId);
  const inboxHandle =
    usableInboxHandle(existing?.inboxHandle, identity.inboxId) ||
    usableInboxHandle(existingProfile?.inboxHandle, identity.inboxId) ||
    usableInboxHandle(input.inboxHandle, identity.inboxId) ||
    createInboxHandle();
  const displayName = input.displayName?.trim() || existing?.displayName || existingProfile?.displayName;

  await store.putProfile({
    inboxHandle,
    inboxId: identity.inboxId,
    displayName,
    updatedAt: now,
  });

  const registration: CachedInboxPushRegistration = {
    ...existing,
    key,
    identity,
    inboxHandle,
    displayName,
    topics: normalizeXmtpPushTopics(input.topics, identity.installationId),
    updatedAt: now,
    pendingDeletion: false,
  };
  await store.putRegistration(registration);
  return registration;
}

export async function updatePushInboxProfile(
  inboxId: string,
  displayName: string | undefined,
  stateStore: PushStateStore = getPushStateStore(),
): Promise<boolean> {
  const normalized = normalizeInboxId(inboxId);
  if (!normalized) return false;
  const profile = await stateStore.getProfileByInboxId(normalized);
  if (!profile) return false;
  const nextDisplayName = displayName?.trim() || undefined;
  const updatedAt = Date.now();
  await stateStore.putProfile({ ...profile, displayName: nextDisplayName, updatedAt });
  return true;
}

function defaultLoadedInboxIds(): string[] {
  const registry = useInboxRegistryStore.getState();
  registry.hydrate();
  return registry.entries.flatMap((entry) => {
    const normalized = normalizeInboxId(entry.inboxId);
    return normalized ? [normalized] : [];
  });
}

function selectOneRegistrationPerInbox(
  registrations: CachedInboxPushRegistration[],
  loadedInboxIds: string[],
  preferredKeys: Set<string>,
): CachedInboxPushRegistration[] {
  const loaded = new Set(loadedInboxIds.map(normalizeInboxId).filter((value): value is string => Boolean(value)));
  const selected = new Map<string, CachedInboxPushRegistration>();
  for (const registration of registrations) {
    if (registration.pendingDeletion) continue;
    const inboxId = normalizeInboxId(registration.identity.inboxId);
    if (!inboxId || (loaded.size > 0 && !loaded.has(inboxId) && !preferredKeys.has(registration.key))) continue;
    const existing = selected.get(inboxId);
    if (
      !existing ||
      (preferredKeys.has(registration.key) && !preferredKeys.has(existing.key)) ||
      (preferredKeys.has(registration.key) === preferredKeys.has(existing.key) && registration.updatedAt > existing.updatedAt)
    ) {
      selected.set(inboxId, registration);
    }
  }
  return Array.from(selected.values());
}

async function registerWithVapidParty(
  payload: VapidPartyXmtpRegistrationPayload,
  {
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
    requestTimeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
  }: PushRuntimeOptions = {},
): Promise<{ registrationId?: string }> {
  return fetchRelayWithTimeout(
    fetchFn,
    joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    async (response) => {
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`vapid.party XMTP registration failed: ${response.status}${errorText ? `: ${errorText}` : ''}`);
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      if (!contentType.includes('application/json')) return {};
      const json = await response.json();
      const registrationId =
        json?.data?.subscriptionId ?? json?.data?.id ?? json?.subscriptionId ?? json?.id;
      return typeof registrationId === 'string' ? { registrationId } : {};
    },
    requestTimeoutMs,
  );
}

async function unregisterWithVapidParty(
  endpoint: string,
  identity: XmtpPushIdentity,
  {
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
    requestTimeoutMs = DEFAULT_RELAY_REQUEST_TIMEOUT_MS,
  }: PushRuntimeOptions = {},
): Promise<void> {
  return fetchRelayWithTimeout(
    fetchFn,
    joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        app: { id: 'converge.cv', origin: getOrigin() },
        endpoint,
        identity,
        deletedAt: new Date().toISOString(),
      }),
    },
    async (response) => {
      if (!response.ok) throw new Error(`vapid.party XMTP unsubscribe failed: ${response.status}`);
    },
    requestTimeoutMs,
  );
}

function staleEndpointRegistrationKey(registration: CachedInboxPushRegistration): string {
  const suffix = typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}`;
  return `${registration.key}:stale-endpoint:${suffix}`;
}

async function removeReplacedEndpointRegistration(
  cached: CachedInboxPushRegistration,
  currentEndpoint: string,
  store: PushStateStore,
  opts: PushRuntimeOptions,
): Promise<void> {
  if (!cached.endpoint || cached.endpoint === currentEndpoint) return;
  try {
    await unregisterWithVapidParty(cached.endpoint, cached.identity, opts);
  } catch (error) {
    console.warn('[Push] Could not delete a replaced browser endpoint relay record', error);
    await store.putRegistration({
      ...cached,
      key: staleEndpointRegistrationKey(cached),
      pendingDeletion: true,
      updatedAt: Date.now(),
    });
  }
}

async function removeSupersededInboxRegistrations(
  current: CachedInboxPushRegistration,
  store: PushStateStore,
  opts: PushRuntimeOptions,
): Promise<void> {
  const registrations = await store.listRegistrations();
  const inboxId = normalizeInboxId(current.identity.inboxId);
  for (const registration of registrations) {
    if (
      registration.key === current.key ||
      normalizeInboxId(registration.identity.inboxId) !== inboxId
    ) {
      continue;
    }
    if (!registration.endpoint) {
      await store.deleteRegistration(registration.key);
      continue;
    }
    try {
      await unregisterWithVapidParty(registration.endpoint, registration.identity, opts);
      await store.deleteRegistration(registration.key);
    } catch (error) {
      console.warn('[Push] Could not delete a superseded inbox/installation relay record', error);
      await store.putRegistration({
        ...registration,
        pendingDeletion: true,
        updatedAt: Date.now(),
      });
    }
  }
}

/** Enable the shared browser subscription and upsert every loaded inbox with cached material. */
export function enablePushForLoadedInboxes(
  registrations: InboxPushRegistrationInput[],
  opts: Omit<EnablePushOptions, 'registrations' | 'identity' | 'topics' | 'displayName'> = {},
): Promise<PushSubscriptionResult> {
  const mutationGeneration = opts.mutationGeneration ?? pushMutationGeneration;
  const browserSubscriptionPromise =
    opts.browserSubscriptionPromise ?? createBrowserPushSubscription(opts);
  return browserSubscriptionPromise
    .then((browserSubscription) =>
      serializePushMutation(() =>
        performEnablePushForLoadedInboxes(registrations, {
          ...opts,
          browserSubscriptionPromise: Promise.resolve(browserSubscription),
          mutationGeneration,
        })
      )
    )
    .catch(async (error) => {
      if (error instanceof BrowserPushProviderError) {
        const store = opts.stateStore ?? getPushStateStore();
        await store.setPreferences({ enabled: false, endpoint: undefined, updatedAt: Date.now() });
        emitPushRegistrationChanged();
      }
      console.error('[Push] Failed to enable push notifications:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    });
}

async function performEnablePushForLoadedInboxes(
  registrations: InboxPushRegistrationInput[],
  opts: Omit<EnablePushOptions, 'registrations' | 'identity' | 'topics' | 'displayName'>,
): Promise<PushSubscriptionResult> {
  if (!hasPushSupport()) return { success: false, error: 'Notifications not supported in this browser' };
  const store = opts.stateStore ?? getPushStateStore();
  let createdSubscription = false;
  let subscription: PushSubscription | null = null;
  let registeredInboxCount = 0;
  let browserSubscriptionPromise: Promise<PushBrowserSubscription> | undefined;

  try {
    if (opts.mutationGeneration !== pushMutationGeneration) {
      const staleBrowserSubscription = await opts.browserSubscriptionPromise?.catch(() => undefined);
      if (staleBrowserSubscription?.created) {
        await staleBrowserSubscription.subscription.unsubscribe().catch(() => undefined);
      }
      return { success: false, error: 'Notification setup was superseded by a later disable or inbox removal' };
    }
    for (const input of registrations) {
      const registrationIdentity = normalizeIdentity(input.identity);
      invalidatedPushRegistrationKeys.delete(pushRegistrationKey(registrationIdentity));
    }
    // Browser subscription starts independently of XMTP topic collection so a
    // slow preference sync cannot consume the click's transient user activation.
    browserSubscriptionPromise =
      opts.browserSubscriptionPromise ?? createBrowserPushSubscription(opts);
    const preparationPromise = (async () => {
      const cachedInputs = await Promise.all(
        registrations.map((input) => cacheInboxPushRegistration(input, { stateStore: store })),
      );
      const preferredKeys = new Set(cachedInputs.map((entry) => entry.key));
      const loadedInboxIds = [
        ...(opts.loadedInboxIds ?? defaultLoadedInboxIds()),
        ...cachedInputs.map((entry) => entry.identity.inboxId),
      ];
      const allCached = await store.listRegistrations();
      const selected = selectOneRegistrationPerInbox(allCached, loadedInboxIds, preferredKeys);
      if (selected.length === 0) {
        throw new Error('No loaded inbox has cached push registration material');
      }
      return selected;
    })();
    const [{ subscription: browserSubscription, created }, selected] = await Promise.all([
      browserSubscriptionPromise,
      preparationPromise,
    ]);
    subscription = browserSubscription;
    createdSubscription = created;
    if (opts.mutationGeneration !== pushMutationGeneration) {
      if (createdSubscription) await subscription.unsubscribe().catch(() => undefined);
      return { success: false, error: 'Notification setup was superseded by a later disable or inbox removal' };
    }

    const serialized = serializePushSubscription(subscription);
    const failedInboxIds: string[] = [];
    const registrationIds: string[] = [];
    let topicCount = 0;

    for (const cached of selected) {
      let remoteRegistered = false;
      try {
        if (opts.mutationGeneration !== pushMutationGeneration) {
          throw new Error('Notification setup was superseded by a later disable or inbox removal');
        }
        const registeredAt = new Date().toISOString();
        const payload = buildVapidPartyXmtpRegistrationPayload({
          identity: cached.identity,
          subscription: serialized,
          topics: cached.topics,
          inboxHandle: cached.inboxHandle,
          registeredAt,
        });
        const registered = await registerWithVapidParty(payload, opts);
        remoteRegistered = true;
        if (opts.mutationGeneration !== pushMutationGeneration) {
          throw new Error('Notification setup was superseded by a later disable or inbox removal');
        }
        const persistedRegistration = {
          ...cached,
          endpoint: subscription.endpoint,
          relayRegistrationId: registered.registrationId,
          registeredAt,
          updatedAt: Date.now(),
          pendingDeletion: false,
        };
        await removeReplacedEndpointRegistration(cached, subscription.endpoint, store, opts);
        await store.putRegistration(persistedRegistration);
        await removeSupersededInboxRegistrations(persistedRegistration, store, opts);
        if (registered.registrationId) registrationIds.push(registered.registrationId);
        topicCount += cached.topics.length;
        registeredInboxCount += 1;
      } catch (error) {
        console.warn('[Push] Failed to register loaded inbox', cached.identity.inboxId, error);
        if (remoteRegistered) {
          try {
            await unregisterWithVapidParty(subscription.endpoint, cached.identity, opts);
          } catch (rollbackError) {
            console.warn('[Push] Failed to roll back a partially persisted relay registration', rollbackError);
            try {
              await store.putRegistration({
                ...cached,
                endpoint: subscription.endpoint,
                pendingDeletion: true,
                updatedAt: Date.now(),
              });
            } catch (tombstoneError) {
              console.warn('[Push] Failed to retain relay rollback tombstone', tombstoneError);
            }
          }
        }
        failedInboxIds.push(cached.identity.inboxId);
      }
    }

    const enabled = registeredInboxCount > 0;
    await store.setPreferences({
      enabled,
      endpoint: enabled ? subscription.endpoint : undefined,
      updatedAt: Date.now(),
    });
    emitPushRegistrationChanged();
    if (!enabled && createdSubscription) await subscription.unsubscribe().catch(() => undefined);

    return {
      success: enabled && failedInboxIds.length === 0,
      endpoint: enabled ? subscription.endpoint : undefined,
      registrationId: registrationIds[0],
      registrationIds,
      topicCount,
      registeredInboxCount,
      failedInboxIds,
      error: failedInboxIds.length > 0 ? `Failed to register ${failedInboxIds.length} loaded inbox${failedInboxIds.length === 1 ? '' : 'es'}` : undefined,
    };
  } catch (error) {
    const browserSubscription =
      subscription && createdSubscription
        ? { subscription, created: true }
        : await browserSubscriptionPromise?.catch(() => undefined);
    if (browserSubscription?.created && registeredInboxCount === 0) {
      await browserSubscription.subscription.unsubscribe().catch(() => undefined);
    }
    console.error('[Push] Failed to enable push notifications:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Compatibility entry point. It refreshes the active inbox, then includes cached inactive inboxes. */
export async function enablePushForCurrentUser(opts: EnablePushOptions = {}): Promise<PushSubscriptionResult> {
  if (!hasPushSupport()) {
    return { success: false, error: 'Notifications not supported in this browser' };
  }
  const mutationGeneration = pushMutationGeneration;
  // Start permission/subscription synchronously, before XMTP topic collection.
  const browserSubscriptionPromise =
    opts.browserSubscriptionPromise ?? createBrowserPushSubscription(opts);
  try {
    const current: InboxPushRegistrationInput = {
      identity: await collectCurrentIdentity(opts.identity),
      topics: await collectCurrentTopics(opts.topics),
      displayName: currentDisplayName(opts.displayName),
    };
    return enablePushForLoadedInboxes([current, ...(opts.registrations ?? [])], {
      ...opts,
      browserSubscriptionPromise,
      mutationGeneration,
    });
  } catch (error) {
    const browserSubscription = await browserSubscriptionPromise.catch(() => undefined);
    if (browserSubscription?.created) {
      await browserSubscription.subscription.unsubscribe().catch(() => undefined);
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Refresh one active inbox without prompting or creating a new browser subscription. */
export function refreshPushRegistrationForInbox(
  input: InboxPushRegistrationInput,
  opts: PushRuntimeOptions = {},
): Promise<PushSubscriptionResult> {
  const identity = normalizeIdentity(input.identity);
  const key = [
    opts.apiBase ?? VAPID_PARTY_API_BASE,
    identity.inboxId,
    identity.installationId,
  ].join('|');
  const request: QueuedPushRefreshRequest = {
    input,
    opts,
    fingerprint: pushRefreshFingerprint(input),
    mutationGeneration: pushMutationGeneration,
  };
  const existing = pushRefreshQueues.get(key);
  if (existing) {
    if (existing.latest.fingerprint !== request.fingerprint) {
      existing.latest = request;
      existing.revision += 1;
    }
    return existing.promise;
  }

  const queue = {
    latest: request,
    revision: 1,
    promise: Promise.resolve({ success: false } as PushSubscriptionResult),
  } satisfies PushRefreshQueue;
  queue.promise = runPushRefreshQueue(queue).finally(() => {
    if (pushRefreshQueues.get(key) === queue) pushRefreshQueues.delete(key);
  });
  pushRefreshQueues.set(key, queue);
  return queue.promise;
}

function pushRefreshFingerprint(input: InboxPushRegistrationInput): string {
  const identity = normalizeIdentity(input.identity);
  const topics = normalizeXmtpPushTopics(input.topics, identity.installationId)
    .map((topic) => ({
      topic: topic.topic,
      hmacKeys: [...topic.hmacKeys].sort((left, right) =>
        `${left.epoch}\0${left.key}`.localeCompare(`${right.epoch}\0${right.key}`)
      ),
    }))
    .sort((left, right) => left.topic.localeCompare(right.topic));
  return JSON.stringify({
    identity,
    topics,
    displayName: input.displayName?.trim() || '',
    inboxHandle: input.inboxHandle?.trim() || '',
  });
}

async function runPushRefreshQueue(queue: PushRefreshQueue): Promise<PushSubscriptionResult> {
  let result: PushSubscriptionResult = { success: false };
  for (;;) {
    const revision = queue.revision;
    const request = queue.latest;
    result = await serializePushMutation(() =>
      performPushRegistrationRefresh(request.input, request.opts, request.mutationGeneration)
    );
    if (queue.revision === revision) return result;
  }
}

async function performPushRegistrationRefresh(
  input: InboxPushRegistrationInput,
  opts: PushRuntimeOptions,
  mutationGeneration: number,
): Promise<PushSubscriptionResult> {
  const store = opts.stateStore ?? getPushStateStore();
  try {
    const identity = normalizeIdentity(input.identity);
    const key = pushRegistrationKey(identity);
    if (mutationGeneration !== pushMutationGeneration) {
      return { success: false, error: 'Push refresh was superseded by a later disable or inbox removal' };
    }
    if (invalidatedPushRegistrationKeys.has(key)) {
      return { success: false, error: 'Push registration was removed for this inbox installation' };
    }
    const preferences = await store.getPreferences();
    if (!preferences.enabled) {
      return {
        success: true,
        registeredInboxCount: 0,
        topicCount: normalizeXmtpPushTopics(input.topics, identity.installationId).length,
      };
    }
    const cached = await cacheInboxPushRegistration(input, { stateStore: store });
    if (!hasPushSupport()) return { success: false, error: 'Notifications not supported in this browser' };
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return { success: false, error: 'Browser push subscription is missing; enable notifications again' };
    const registeredAt = new Date().toISOString();
    const registered = await registerWithVapidParty(
      buildVapidPartyXmtpRegistrationPayload({
        identity: cached.identity,
        subscription: serializePushSubscription(subscription),
        topics: cached.topics,
        inboxHandle: cached.inboxHandle,
        registeredAt,
      }),
      opts,
    );
    const persistedRegistration = {
      ...cached,
      endpoint: subscription.endpoint,
      relayRegistrationId: registered.registrationId,
      registeredAt,
      updatedAt: Date.now(),
      pendingDeletion: false,
    };
    await removeReplacedEndpointRegistration(cached, subscription.endpoint, store, opts);
    await store.putRegistration(persistedRegistration);
    await removeSupersededInboxRegistrations(persistedRegistration, store, opts);
    await store.setPreferences({ enabled: true, endpoint: subscription.endpoint, updatedAt: Date.now() });
    return {
      success: true,
      endpoint: subscription.endpoint,
      registrationId: registered.registrationId,
      registrationIds: registered.registrationId ? [registered.registrationId] : [],
      registeredInboxCount: 1,
      topicCount: cached.topics.length,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function refreshPushRegistrationForCurrentInbox(
  opts: EnablePushOptions = {},
): Promise<PushSubscriptionResult> {
  try {
    return refreshPushRegistrationForInbox(
      {
        identity: await collectCurrentIdentity(opts.identity),
        topics: await collectCurrentTopics(opts.topics),
        displayName: currentDisplayName(opts.displayName),
      },
      opts,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getAppPushStatus(
  options: { loadedInboxIds?: string[]; stateStore?: PushStateStore } = {},
): Promise<AppPushStatus> {
  if (!hasPushSupport()) {
    return {
      state: 'unsupported',
      enabledPreference: false,
      hasBrowserSubscription: false,
      registeredInboxCount: 0,
      expectedInboxCount: 0,
      missingInboxIds: [],
      pendingDeletionCount: 0,
    };
  }
  const store = options.stateStore ?? getPushStateStore();
  try {
    const [preferences, cached, serviceWorker] = await Promise.all([
      store.getPreferences(),
      store.listRegistrations(),
      navigator.serviceWorker.getRegistration(),
    ]);
    const subscription = await serviceWorker?.pushManager.getSubscription() ?? null;
    const expected = Array.from(
      new Set((options.loadedInboxIds ?? defaultLoadedInboxIds()).map(normalizeInboxId).filter((value): value is string => Boolean(value))),
    );
    const matching = cached.filter(
      (entry) =>
        !entry.pendingDeletion &&
        Boolean(subscription) &&
        entry.endpoint === subscription?.endpoint &&
        (expected.length === 0 || expected.includes(normalizeInboxId(entry.identity.inboxId) ?? '')),
    );
    const registeredInboxIds = new Set(matching.map((entry) => normalizeInboxId(entry.identity.inboxId)));
    const missingInboxIds = expected.filter((inboxId) => !registeredInboxIds.has(inboxId));
    const pendingDeletionCount = cached.filter((entry) => entry.pendingDeletion).length;
    const fullyEnabled =
      preferences.enabled && Boolean(subscription) && matching.length > 0 && missingInboxIds.length === 0;
    return {
      state:
        pendingDeletionCount > 0
          ? 'partial'
          : !preferences.enabled
            ? 'disabled'
            : fullyEnabled
              ? 'enabled'
              : 'partial',
      enabledPreference: preferences.enabled,
      hasBrowserSubscription: Boolean(subscription),
      endpoint: subscription?.endpoint,
      registeredInboxCount: matching.length,
      expectedInboxCount: expected.length,
      missingInboxIds,
      pendingDeletionCount,
    };
  } catch (error) {
    console.warn('[Push] Failed to read app-level push status', error);
    return {
      state: 'disabled',
      enabledPreference: false,
      hasBrowserSubscription: false,
      registeredInboxCount: 0,
      expectedInboxCount: 0,
      missingInboxIds: [],
      pendingDeletionCount: 0,
    };
  }
}

export async function isPushEnabled(): Promise<boolean> {
  return (await getAppPushStatus()).state === 'enabled';
}

/** Delete every known relay record before removing the one shared browser endpoint. */
export function disablePush(opts: DisablePushOptions = {}): Promise<boolean> {
  supersedePushMutations();
  return serializePushMutation(() => performDisablePush(opts));
}

async function performDisablePush(opts: DisablePushOptions): Promise<boolean> {
  const store = opts.stateStore ?? getPushStateStore();
  try {
    const [preferences, serviceWorker, cached] = await Promise.all([
      store.getPreferences(),
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.getRegistration()
        : Promise.resolve(undefined),
      store.listRegistrations(),
    ]);
    const subscription = await serviceWorker?.pushManager.getSubscription() ?? null;
    const fallbackIdentity = await collectCurrentIdentity(opts.identity).catch(() => undefined);
    const records = [...cached];
    if (fallbackIdentity && !records.some((entry) => entry.key === pushRegistrationKey(fallbackIdentity))) {
      records.push({
        key: pushRegistrationKey(fallbackIdentity),
        identity: fallbackIdentity,
        inboxHandle: 'legacy-current-inbox',
        topics: [],
        endpoint: subscription?.endpoint ?? preferences.endpoint,
        updatedAt: Date.now(),
      });
    }

    let relayCleanupSucceeded = true;
    for (const record of records) {
      const endpoint = record.endpoint ?? subscription?.endpoint ?? preferences.endpoint;
      if (!endpoint) {
        await store.deleteRegistration(record.key);
        continue;
      }
      try {
        await unregisterWithVapidParty(endpoint, record.identity, opts);
        await store.deleteRegistration(record.key);
      } catch (error) {
        relayCleanupSucceeded = false;
        console.warn('[Push] Relay cleanup failed; retaining a deletion tombstone for retry', error);
        await store.putRegistration({ ...record, endpoint, pendingDeletion: true, updatedAt: Date.now() });
      }
    }

    const unsubscribed = subscription ? await subscription.unsubscribe() : true;
    await store.setPreferences({ enabled: false, updatedAt: Date.now() });
    emitPushRegistrationChanged();
    try {
      await store.clearActivity();
    } finally {
      emitPushActivityCleared();
    }
    console.log('[Push] Disabled app-level notifications for this browser');
    return unsubscribed && relayCleanupSucceeded;
  } catch (error) {
    console.error('[Push] Failed to disable push notifications:', error);
    return false;
  }
}

/** Remove one inbox's relay/cache state, for example while burning a local inbox. */
export function removePushRegistrationForInbox(
  inboxId: string,
  opts: PushRuntimeOptions = {},
): Promise<boolean> {
  const normalized = normalizeInboxId(inboxId);
  if (!normalized) return Promise.resolve(false);
  supersedePushMutations();
  invalidatePushRefreshesForInbox(normalized);
  return serializePushMutation(() => performRemovePushRegistrationForInbox(normalized, opts));
}

function invalidatePushRefreshesForInbox(inboxId: string): void {
  const xmtp = getXmtpClient();
  const storedIdentity = useAuthStore.getState().identity;
  const currentInboxId = xmtp.getInboxId() ?? storedIdentity?.inboxId;
  const currentInstallationId = xmtp.getInstallationId() ?? storedIdentity?.installationId;
  if (currentInboxId && currentInstallationId && normalizeInboxId(currentInboxId) === inboxId) {
    try {
      invalidatedPushRegistrationKeys.add(pushRegistrationKey(normalizeIdentity({
        inboxId: currentInboxId,
        installationId: currentInstallationId,
        address: xmtp.getAddress() ?? storedIdentity?.address,
      })));
    } catch {
      // Invalid legacy identifiers cannot produce a usable push registration.
    }
  }
  for (const queue of pushRefreshQueues.values()) {
    const identity = normalizeIdentity(queue.latest.input.identity);
    if (identity.inboxId === inboxId) {
      invalidatedPushRegistrationKeys.add(pushRegistrationKey(identity));
    }
  }
}

async function performRemovePushRegistrationForInbox(
  normalized: string,
  opts: PushRuntimeOptions,
): Promise<boolean> {
  const store = opts.stateStore ?? getPushStateStore();
  let relayCleanupSucceeded = true;
  try {
    const [recordsResult, profileResult, preferencesResult, serviceWorkerResult] = await Promise.allSettled([
      store.listRegistrations(),
      store.getProfileByInboxId(normalized),
      store.getPreferences(),
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.getRegistration()
        : Promise.resolve(undefined),
    ]);
    if (
      recordsResult.status === 'rejected' ||
      profileResult.status === 'rejected' ||
      preferencesResult.status === 'rejected' ||
      serviceWorkerResult.status === 'rejected'
    ) {
      relayCleanupSucceeded = false;
    }
    const records = recordsResult.status === 'fulfilled' ? recordsResult.value : [];
    for (const record of records) {
      if (normalizeInboxId(record.identity.inboxId) === normalized) {
        invalidatedPushRegistrationKeys.add(record.key);
      }
    }
    const profile = profileResult.status === 'fulfilled' ? profileResult.value : undefined;
    const preferences =
      preferencesResult.status === 'fulfilled'
        ? preferencesResult.value
        : { enabled: false, updatedAt: 0 };
    const serviceWorker =
      serviceWorkerResult.status === 'fulfilled' ? serviceWorkerResult.value : undefined;
    let subscription: PushSubscription | null = null;
    try {
      subscription = await serviceWorker?.pushManager.getSubscription() ?? null;
    } catch (error) {
      relayCleanupSucceeded = false;
      console.warn('[Push] Could not inspect the shared subscription during inbox cleanup', error);
    }
    for (const record of records.filter((entry) => normalizeInboxId(entry.identity.inboxId) === normalized)) {
      const endpoint = record.endpoint ?? subscription?.endpoint ?? preferences.endpoint;
      if (endpoint) {
        try {
          await unregisterWithVapidParty(endpoint, record.identity, opts);
        } catch (error) {
          relayCleanupSucceeded = false;
          console.warn('[Push] Failed to remove burned inbox from push relay', error);
        }
      }
      try {
        await store.deleteRegistration(record.key);
      } catch (error) {
        relayCleanupSucceeded = false;
        console.warn('[Push] Failed to remove burned inbox registration cache', error);
      }
    }
    if (profile) {
      try {
        await store.deleteActivity(profile.inboxHandle);
      } catch (error) {
        relayCleanupSucceeded = false;
        console.warn('[Push] Failed to remove burned inbox activity cache', error);
      }
      try {
        await store.deleteProfile(profile.inboxHandle);
      } catch (error) {
        relayCleanupSucceeded = false;
        console.warn('[Push] Failed to remove burned inbox profile cache', error);
      }
    }
    return relayCleanupSucceeded;
  } catch (error) {
    console.warn('[Push] Failed to clear inbox push state', error);
    return false;
  } finally {
    emitPushActivityCleared(normalized);
  }
}

/** @deprecated Use removePushRegistrationForInbox. */
export async function removeInboxPushRegistration(
  inboxId: string,
  opts: PushRuntimeOptions = {},
): Promise<boolean> {
  return removePushRegistrationForInbox(inboxId, opts);
}

export async function listPendingPushActivity(
  stateStore: PushStateStore = getPushStateStore(),
): Promise<PendingInboxActivity[]> {
  const activity = await stateStore.listActivity();
  return Promise.all(
    activity.map(async (hint) => {
      const profile = await stateStore.getProfileByHandle(hint.inboxHandle);
      return {
        ...hint,
        inboxId: profile?.inboxId,
        displayName: profile?.displayName,
      };
    }),
  );
}

export async function clearPushActivityForInbox(
  inboxId: string,
  stateStore: PushStateStore = getPushStateStore(),
): Promise<void> {
  const normalized = normalizeInboxId(inboxId);
  if (!normalized) return;
  const profile = await stateStore.getProfileByInboxId(normalized);
  if (profile) await stateStore.deleteActivity(profile.inboxHandle);
  emitPushActivityCleared(normalized);
}

export function listenForPushActivityCleared(
  listener: (inboxId?: string) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleCleared = (event: Event) => {
    const customEvent = event as CustomEvent<{ inboxId?: unknown }>;
    const inboxId =
      typeof customEvent.detail?.inboxId === 'string'
        ? normalizeInboxId(customEvent.detail.inboxId) ?? undefined
        : undefined;
    listener(inboxId);
  };
  window.addEventListener(PUSH_ACTIVITY_CLEARED_EVENT, handleCleared);
  return () => window.removeEventListener(PUSH_ACTIVITY_CLEARED_EVENT, handleCleared);
}

export function listenForPushActivity(listener: (activity: PendingInboxActivity) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const handleMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.type !== 'converge.push.activity' || typeof data.inboxHandle !== 'string') return;
    const receivedAt = typeof data.receivedAt === 'number' ? data.receivedAt : Date.now();
    void getPushStateStore().getProfileByHandle(data.inboxHandle).then((profile) => {
      listener({
        inboxHandle: data.inboxHandle,
        inboxId: profile?.inboxId,
        displayName: profile?.displayName,
        receivedAt,
        count: typeof data.count === 'number' ? data.count : 1,
      });
    });
  };
  navigator.serviceWorker.addEventListener('message', handleMessage);
  return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
}

export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
