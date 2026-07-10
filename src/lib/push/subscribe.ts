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

export type PushRuntimeOptions = {
  apiBase?: string;
  fetchFn?: FetchLike;
  stateStore?: PushStateStore;
};

export type EnablePushOptions = PushRuntimeOptions & {
  identity?: Partial<XmtpPushIdentity>;
  topics?: XmtpPushTopic[];
  displayName?: string;
  loadedInboxIds?: string[];
  registrations?: InboxPushRegistrationInput[];
  vapidPublicKey?: string;
};

export type DisablePushOptions = PushRuntimeOptions & {
  identity?: Partial<XmtpPushIdentity>;
};

function joinApiPath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
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
  return hmacMapEntries(value)
    .map(([topic, entries]) => ({ topic, hmacKeys: normalizeHmacKeyEntries(entries) }))
    .filter((topic) => topic.topic.trim() && topic.hmacKeys.length > 0);
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
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
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
  if (vapidPublicKey && vapidPublicKey.length > 10) return vapidPublicKey;
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
    if (typeof key === 'string' && key.trim()) return key.trim();
  } else {
    const text = (await response.text()).trim();
    if (text) return text;
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
  const installationId = identity.installationId.trim();
  if (!inboxId || !installationId) throw new Error('Inbox and installation IDs are required for push');
  return {
    inboxId,
    installationId,
    address: identity.address?.trim() || undefined,
  };
}

function normalizeTopics(topics: XmtpPushTopic[]): XmtpPushTopic[] {
  return topics
    .map((entry) => ({
      topic: entry.topic.trim(),
      hmacKeys: entry.hmacKeys
        .map((key) => ({ epoch: key.epoch.trim(), key: key.key.trim() }))
        .filter((key) => key.epoch && key.key),
    }))
    .filter((entry) => entry.topic && entry.hmacKeys.length > 0);
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
    topics: normalizeTopics(input.topics),
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
  { apiBase = VAPID_PARTY_API_BASE, fetchFn = fetch }: PushRuntimeOptions = {},
): Promise<{ registrationId?: string }> {
  const response = await fetchFn(joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`vapid.party XMTP registration failed: ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) return {};
  const json = await response.json();
  const registrationId = json?.data?.id ?? json?.id;
  return typeof registrationId === 'string' ? { registrationId } : {};
}

async function unregisterWithVapidParty(
  endpoint: string,
  identity: XmtpPushIdentity,
  { apiBase = VAPID_PARTY_API_BASE, fetchFn = fetch }: PushRuntimeOptions = {},
): Promise<void> {
  const response = await fetchFn(joinApiPath(apiBase, VAPID_PARTY_XMTP_SUBSCRIPTIONS_PATH), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      app: { id: 'converge.cv', origin: getOrigin() },
      endpoint,
      identity,
      deletedAt: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`vapid.party XMTP unsubscribe failed: ${response.status}`);
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
export async function enablePushForLoadedInboxes(
  registrations: InboxPushRegistrationInput[],
  opts: Omit<EnablePushOptions, 'registrations' | 'identity' | 'topics' | 'displayName'> = {},
): Promise<PushSubscriptionResult> {
  if (!hasPushSupport()) return { success: false, error: 'Notifications not supported in this browser' };
  const store = opts.stateStore ?? getPushStateStore();
  let createdSubscription = false;
  let subscription: PushSubscription | null = null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { success: false, error: `Notification permission ${permission}` };

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
      return { success: false, error: 'No loaded inbox has cached push registration material' };
    }

    const serviceWorker = await ensureServiceWorkerRegistration();
    const publicKey = await getVapidPublicKey({
      apiBase: opts.apiBase,
      vapidPublicKey: opts.vapidPublicKey,
      fetchFn: opts.fetchFn,
    });
    subscription = await serviceWorker.pushManager.getSubscription();
    if (!subscription) {
      subscription = await serviceWorker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      createdSubscription = true;
    }

    const serialized = serializePushSubscription(subscription);
    const failedInboxIds: string[] = [];
    const registrationIds: string[] = [];
    let topicCount = 0;
    let registeredInboxCount = 0;

    for (const cached of selected) {
      try {
        const registeredAt = new Date().toISOString();
        const payload = buildVapidPartyXmtpRegistrationPayload({
          identity: cached.identity,
          subscription: serialized,
          topics: cached.topics,
          inboxHandle: cached.inboxHandle,
          registeredAt,
        });
        const registered = await registerWithVapidParty(payload, opts);
        if (registered.registrationId) registrationIds.push(registered.registrationId);
        topicCount += cached.topics.length;
        registeredInboxCount += 1;
        const persistedRegistration = {
          ...cached,
          endpoint: subscription.endpoint,
          relayRegistrationId: registered.registrationId,
          registeredAt,
          updatedAt: Date.now(),
          pendingDeletion: false,
        };
        await store.putRegistration(persistedRegistration);
        await removeSupersededInboxRegistrations(persistedRegistration, store, opts);
      } catch (error) {
        console.warn('[Push] Failed to register loaded inbox', cached.identity.inboxId, error);
        failedInboxIds.push(cached.identity.inboxId);
      }
    }

    const enabled = registeredInboxCount > 0;
    await store.setPreferences({
      enabled,
      endpoint: enabled ? subscription.endpoint : undefined,
      updatedAt: Date.now(),
    });
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
    if (createdSubscription && subscription) await subscription.unsubscribe().catch(() => undefined);
    console.error('[Push] Failed to enable push notifications:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Compatibility entry point. It refreshes the active inbox, then includes cached inactive inboxes. */
export async function enablePushForCurrentUser(opts: EnablePushOptions = {}): Promise<PushSubscriptionResult> {
  try {
    const current: InboxPushRegistrationInput = {
      identity: await collectCurrentIdentity(opts.identity),
      topics: await collectCurrentTopics(opts.topics),
      displayName: currentDisplayName(opts.displayName),
    };
    return enablePushForLoadedInboxes([current, ...(opts.registrations ?? [])], opts);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Refresh one active inbox without prompting or creating a new browser subscription. */
export async function refreshPushRegistrationForInbox(
  input: InboxPushRegistrationInput,
  opts: PushRuntimeOptions = {},
): Promise<PushSubscriptionResult> {
  const store = opts.stateStore ?? getPushStateStore();
  try {
    const cached = await cacheInboxPushRegistration(input, { stateStore: store });
    const preferences = await store.getPreferences();
    if (!preferences.enabled) return { success: true, registeredInboxCount: 0, topicCount: cached.topics.length };
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
export async function disablePush(opts: DisablePushOptions = {}): Promise<boolean> {
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
export async function removePushRegistrationForInbox(
  inboxId: string,
  opts: PushRuntimeOptions = {},
): Promise<boolean> {
  const store = opts.stateStore ?? getPushStateStore();
  const normalized = normalizeInboxId(inboxId);
  if (!normalized) return false;
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
