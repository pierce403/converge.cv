import { useAuthStore, useConversationStore, useInboxRegistryStore } from '@/lib/stores';
import { getInboxDisplayLabel } from '@/lib/stores/inbox-registry-store';
import { normalizeInboxId } from '@/lib/utils/inbox';
import { VAPID_PARTY_API_BASE } from './config';
import {
  ensurePushServiceWorkerRegistration,
  getAppPushStatus,
  getBrowserPushSubscriptionState,
  getXmtpPushServiceStatus,
  type AppPushStatus,
  type PushRuntimeOptions,
  type XmtpPushServiceStatus,
} from './subscribe';
import {
  getPushStateStore,
  type CachedInboxPushRegistration,
  type PushDiagnosticReceipt,
  type PushStateStore,
} from './state';

const DIAGNOSTIC_REQUEST_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_RECEIPT_EVENT = 'converge.push.diagnostic';

export type RelayRegistrationDiagnostic = {
  state: 'verified' | 'missing-capability' | 'unreachable' | 'inactive';
  checkedAt?: string;
  registeredAt?: string;
  updatedAt?: string;
  groupTopicCount?: number;
  welcomeTopicCount?: number;
  hmacEpochCount?: number;
  coverage?: 'complete' | 'welcome_only' | 'missing_welcome' | 'empty';
  routeStatus?: 'synced' | 'pending' | 'unavailable' | string;
  routeUpdatedAt?: string;
  deliveryReady?: boolean;
  listenerStatus?: string;
  bridgeStatus?: string;
  lastMatchedAt?: string;
  deliveryStatus?: 'none' | 'queued' | 'sent' | 'failed' | 'expired' | string;
  lastAttemptAt?: string;
  providerAcceptedAt?: string;
  failureCategory?: string;
  detail: string;
};

export type InboxPushDiagnostic = {
  label: string;
  isCurrent: boolean;
  localState: 'registered' | 'local-only' | 'pending-registration' | 'pending-deletion' | 'stale-endpoint';
  registeredAt?: string;
  updatedAt: number;
  groupTopicCount: number;
  welcomeTopicCount: number;
  hmacEpochCount: number;
  endpointMatchesBrowser: boolean;
  relayReceiptStored: boolean;
  relay: RelayRegistrationDiagnostic;
  lastActivityAt?: number;
  activityCount: number;
};

export type PushDiagnosticSnapshot = {
  checkedAt: string;
  permission: NotificationPermission | 'unsupported';
  serviceWorker: {
    registered: boolean;
    scope: 'root' | 'recovery' | 'other' | 'none';
    state: ServiceWorkerState | 'unknown' | 'none';
  };
  browserSubscription: {
    present: boolean;
    providerHost?: string;
    expiresAt?: number | null;
  };
  app: AppPushStatus;
  relay: XmtpPushServiceStatus;
  inboxes: InboxPushDiagnostic[];
  staleRegistrationCount: number;
  lastActivityAt?: number;
  lastDiagnosticReceipt?: PushDiagnosticReceipt;
  activeConversationCount: number;
  findings: string[];
};

export type PushDiagnosticTestResult = {
  queued: boolean;
  testId?: string;
  checkedAt?: string;
};

type FetchLike = typeof fetch;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function countValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function isoStringValue(value: unknown): string | undefined {
  const candidate = stringValue(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  const candidate = stringValue(value);
  return candidate && (allowed as readonly string[]).includes(candidate)
    ? candidate as T[number]
    : undefined;
}

function diagnosticUrl(
  registration: CachedInboxPushRegistration,
  apiBase: string,
  kind: 'status' | 'test',
): { url: URL; authorization: string } | null {
  const capability = registration.relayDiagnostics;
  if (!capability || !/^[A-Za-z0-9_-]{43}$/.test(capability.receipt)) return null;
  const expectedStatusPath = '/api/xmtp/status';
  if (capability.statusPath !== expectedStatusPath) return null;
  const path = kind === 'test'
    ? capability.testPath ?? `${expectedStatusPath}/test`
    : capability.statusPath;
  if (kind === 'test' && path !== `${expectedStatusPath}/test`) return null;

  try {
    const base = new URL(apiBase);
    const target = new URL(path, base.origin);
    if (
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      return null;
    }
    return { url: target, authorization: `Bearer ${capability.receipt}` };
  } catch {
    return null;
  }
}

async function diagnosticFetch(
  url: URL,
  init: RequestInit,
  fetchFn: FetchLike,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchFn(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRelayPushRegistrationStatus(
  registration: CachedInboxPushRegistration,
  {
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
    requestTimeoutMs = DIAGNOSTIC_REQUEST_TIMEOUT_MS,
  }: PushRuntimeOptions = {},
): Promise<RelayRegistrationDiagnostic> {
  const request = diagnosticUrl(registration, apiBase, 'status');
  if (!request) {
    return {
      state: 'missing-capability',
      detail: 'Re-register this inbox to create a private relay diagnostic receipt.',
    };
  }

  try {
    const response = await diagnosticFetch(
      request.url,
      { method: 'POST', headers: { Authorization: request.authorization } },
      fetchFn,
      requestTimeoutMs,
    );
    if (response.status === 404 || response.status === 410) {
      return {
        state: 'inactive',
        detail: 'The relay no longer has an active registration for this local record.',
      };
    }
    if (!response.ok) {
      return {
        state: 'unreachable',
        detail: `Relay registration check returned HTTP ${response.status}.`,
      };
    }
    const payload = objectValue(await response.json());
    const data = objectValue(payload?.data) ?? payload ?? {};
    const remoteRegistration = objectValue(data.registration) ?? {};
    const route = objectValue(data.route) ?? {};
    const pipeline = objectValue(data.pipeline) ?? {};
    const deliveries = objectValue(data.deliveries) ?? {};
    const delivery = objectValue(deliveries.xmtp) ?? objectValue(data.delivery) ?? {};
    const status = stringValue(remoteRegistration.status);
    if (status && status !== 'active') {
      return {
        state: 'inactive',
        checkedAt: stringValue(data.checkedAt),
        detail: `The relay reports this logical registration as ${status}.`,
      };
    }
    const checkedAt = isoStringValue(data.checkedAt);
    const registeredAt = isoStringValue(remoteRegistration.registeredAt);
    const updatedAt = isoStringValue(remoteRegistration.updatedAt);
    const groupTopicCount = countValue(remoteRegistration.groupTopicCount);
    const welcomeTopicCount = countValue(remoteRegistration.welcomeTopicCount);
    const hmacEpochCount = countValue(remoteRegistration.hmacEpochCount);
    const coverage = enumValue(remoteRegistration.coverage, [
      'complete',
      'welcome_only',
      'missing_welcome',
      'empty',
    ] as const);
    const routeStatus = enumValue(route.status, ['synced', 'pending', 'unavailable'] as const);
    const listenerStatus = enumValue(
      pipeline.listenerStatus,
      ['ready', 'not_ready', 'unknown', 'not_configured'] as const,
    );
    const bridgeStatus = enumValue(
      pipeline.bridgeStatus,
      ['synced', 'pending', 'failed', 'not_configured'] as const,
    );
    const deliveryStatus = enumValue(
      delivery.status,
      ['none', 'queued', 'sent', 'failed', 'expired'] as const,
    );
    if (
      data.version !== 1 ||
      status !== 'active' ||
      !checkedAt ||
      !registeredAt ||
      !updatedAt ||
      groupTopicCount === undefined ||
      welcomeTopicCount === undefined ||
      hmacEpochCount === undefined ||
      !coverage ||
      !routeStatus ||
      typeof pipeline.deliveryReady !== 'boolean' ||
      !listenerStatus ||
      !bridgeStatus ||
      !deliveryStatus
    ) {
      return {
        state: 'unreachable',
        detail: 'Relay registration check returned an unrecognized response shape.',
      };
    }
    return {
      state: 'verified',
      checkedAt,
      registeredAt,
      updatedAt,
      groupTopicCount,
      welcomeTopicCount,
      hmacEpochCount,
      coverage,
      routeStatus,
      routeUpdatedAt: isoStringValue(route.updatedAt),
      deliveryReady: pipeline.deliveryReady,
      listenerStatus,
      bridgeStatus,
      lastMatchedAt: isoStringValue(delivery.lastMatchedAt ?? delivery.lastEnvelopeMatchedAt),
      deliveryStatus,
      lastAttemptAt: isoStringValue(delivery.lastAttemptAt),
      providerAcceptedAt: isoStringValue(delivery.providerAcceptedAt),
      failureCategory: stringValue(delivery.failureCategory),
      detail: 'Relay registration verified with its private diagnostic receipt.',
    };
  } catch {
    return {
      state: 'unreachable',
      detail: 'The private relay registration check could not be completed.',
    };
  }
}

export async function sendRelayPushDiagnosticTest(
  registration: CachedInboxPushRegistration,
  {
    apiBase = VAPID_PARTY_API_BASE,
    fetchFn = fetch,
    requestTimeoutMs = DIAGNOSTIC_REQUEST_TIMEOUT_MS,
  }: PushRuntimeOptions = {},
): Promise<PushDiagnosticTestResult> {
  const request = diagnosticUrl(registration, apiBase, 'test');
  if (!request) throw new Error('Re-register this inbox before sending a relay test.');
  const response = await diagnosticFetch(
    request.url,
    { method: 'POST', headers: { Authorization: request.authorization } },
    fetchFn,
    requestTimeoutMs,
  );
  if (!response.ok) {
    throw new Error(`Relay test request returned HTTP ${response.status}.`);
  }
  const payload = objectValue(await response.json());
  const data = objectValue(payload?.data) ?? payload ?? {};
  const testId = stringValue(data.testId);
  const checkedAt = isoStringValue(data.checkedAt);
  if (data.queued !== true || !testId || !/^[A-Za-z0-9_-]{8,128}$/.test(testId) || !checkedAt) {
    throw new Error('Relay test returned an unrecognized response shape.');
  }
  return {
    queued: true,
    testId,
    checkedAt,
  };
}

function registrationWorkerState(registration?: ServiceWorkerRegistration): ServiceWorkerState | 'unknown' | 'none' {
  if (!registration) return 'none';
  return registration.active?.state ?? registration.waiting?.state ?? registration.installing?.state ?? 'unknown';
}

function registrationScope(registration?: ServiceWorkerRegistration): 'root' | 'recovery' | 'other' | 'none' {
  if (!registration) return 'none';
  try {
    const path = new URL(registration.scope).pathname;
    if (path === '/') return 'root';
    if (path.startsWith('/__converge-push/')) return 'recovery';
    return 'other';
  } catch {
    return 'other';
  }
}

function providerHost(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

function topicCounts(registration: CachedInboxPushRegistration): {
  groupTopicCount: number;
  welcomeTopicCount: number;
  hmacEpochCount: number;
} {
  let groupTopicCount = 0;
  let welcomeTopicCount = 0;
  let hmacEpochCount = 0;
  for (const topic of registration.topics) {
    if (/^\/xmtp\/mls\/1\/g-[0-9a-f]{32}\/proto$/i.test(topic.topic)) groupTopicCount += 1;
    if (/^\/xmtp\/mls\/1\/w-[0-9a-f]{64}\/proto$/i.test(topic.topic)) welcomeTopicCount += 1;
    hmacEpochCount += topic.hmacKeys.length;
  }
  return { groupTopicCount, welcomeTopicCount, hmacEpochCount };
}

function selectInboxRegistrations(
  registrations: CachedInboxPushRegistration[],
  loadedInboxIds: string[],
  endpoint: string | undefined,
): { selected: CachedInboxPushRegistration[]; staleCount: number } {
  const loaded = new Set(loadedInboxIds);
  const candidates = registrations.filter((entry) => {
    const inboxId = normalizeInboxId(entry.identity.inboxId);
    return inboxId && (loaded.size === 0 || loaded.has(inboxId));
  });
  const selected = new Map<string, CachedInboxPushRegistration>();
  for (const candidate of candidates) {
    const inboxId = normalizeInboxId(candidate.identity.inboxId);
    if (!inboxId) continue;
    const existing = selected.get(inboxId);
    const candidateScore = (candidate.pendingDeletion ? 0 : 4) + (candidate.endpoint === endpoint ? 2 : 0);
    const existingScore = existing
      ? (existing.pendingDeletion ? 0 : 4) + (existing.endpoint === endpoint ? 2 : 0)
      : -1;
    if (!existing || candidateScore > existingScore || (
      candidateScore === existingScore && candidate.updatedAt > existing.updatedAt
    )) {
      selected.set(inboxId, candidate);
    }
  }
  return { selected: [...selected.values()], staleCount: Math.max(0, candidates.length - selected.size) };
}

export async function getPushDiagnosticSnapshot(
  options: PushRuntimeOptions & { stateStore?: PushStateStore } = {},
): Promise<PushDiagnosticSnapshot> {
  const store = options.stateStore ?? getPushStateStore();
  useInboxRegistryStore.getState().hydrate();
  const entries = useInboxRegistryStore.getState().entries;
  const loadedInboxIds = entries
    .map((entry) => normalizeInboxId(entry.inboxId))
    .filter((value): value is string => Boolean(value));
  const currentInboxId = normalizeInboxId(useAuthStore.getState().identity?.inboxId);
  const activeConversationCount = useConversationStore.getState().conversations.filter(
    (conversation) =>
      !conversation.isLocalOnly &&
      !conversation.id.startsWith('local-conversation'),
  ).length;
  const [preferences, registrations, activities, lastDiagnosticReceipt, browser, relay, app] = await Promise.all([
    store.getPreferences(),
    store.listRegistrations(),
    store.listActivity(),
    store.getLastDiagnosticReceipt(),
    getBrowserPushSubscriptionState(),
    getXmtpPushServiceStatus(options),
    getAppPushStatus({ loadedInboxIds, stateStore: store }),
  ]);
  const endpoint = browser.subscription?.endpoint;
  const { selected, staleCount } = selectInboxRegistrations(registrations, loadedInboxIds, endpoint);
  const diagnostics = await Promise.all(selected.map(async (registration, index): Promise<InboxPushDiagnostic> => {
    const inboxId = normalizeInboxId(registration.identity.inboxId);
    const entry = entries.find((candidate) => normalizeInboxId(candidate.inboxId) === inboxId);
    const profile = inboxId ? await store.getProfileByInboxId(inboxId) : undefined;
    const activity = activities.find((candidate) => candidate.inboxHandle === registration.inboxHandle);
    const counts = topicCounts(registration);
    const endpointMatchesBrowser = Boolean(endpoint && registration.endpoint === endpoint);
    const relayStatus = !registration.pendingDeletion && endpointMatchesBrowser
      ? await getRelayPushRegistrationStatus(registration, options)
      : {
          state: registration.pendingDeletion ? 'inactive' : 'unreachable',
          detail: registration.pendingDeletion
            ? 'This local record is waiting for relay deletion.'
            : 'This record belongs to a different browser subscription.',
        } satisfies RelayRegistrationDiagnostic;
    return {
      label: entry ? getInboxDisplayLabel(entry) : profile?.displayName || registration.displayName || `Loaded inbox ${index + 1}`,
      isCurrent: Boolean(inboxId && inboxId === currentInboxId),
      localState: registration.pendingDeletion
        ? 'pending-deletion'
        : registration.pendingRegistration
          ? 'pending-registration'
          : !registration.endpoint
            ? 'local-only'
            : endpointMatchesBrowser
              ? 'registered'
              : 'stale-endpoint',
      registeredAt: registration.registeredAt,
      updatedAt: registration.updatedAt,
      ...counts,
      endpointMatchesBrowser,
      relayReceiptStored: Boolean(registration.relayDiagnostics),
      relay: relayStatus,
      lastActivityAt: activity?.receivedAt,
      activityCount: activity?.count ?? 0,
    };
  }));

  const findings: string[] = [];
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  if (permission !== 'granted') findings.push('Allow site notifications before testing delivery.');
  if (!browser.registration) findings.push('The Converge service worker is not registered.');
  else if (registrationWorkerState(browser.registration) !== 'activated') findings.push('The Converge service worker is not active.');
  if (!browser.subscription) findings.push('This browser does not have a Web Push subscription.');
  if (!preferences.enabled) findings.push('Converge notifications are disabled in local app preferences.');
  if (app.missingInboxIds.length > 0) findings.push(`${app.missingInboxIds.length} loaded inbox registration(s) are missing locally.`);
  if (app.pendingRegistrationCount > 0) findings.push(`${app.pendingRegistrationCount} active relay registration(s) need a local retry to finish setup.`);
  if (app.pendingDeletionCount > 0) findings.push(`${app.pendingDeletionCount} relay deletion(s) still need to be retried.`);
  for (const inbox of diagnostics) {
    if (inbox.isCurrent && activeConversationCount > 0 && inbox.groupTopicCount === 0) {
      findings.push(`${inbox.label} has conversations, but no conversation HMAC topics were published. Re-register this inbox.`);
    }
    if (inbox.welcomeTopicCount !== 1) findings.push(`${inbox.label} does not have exactly one installation welcome topic.`);
    if (inbox.relay.state === 'missing-capability') findings.push(`${inbox.label} needs re-registration before its relay record can be verified.`);
    if (inbox.relay.state === 'inactive') findings.push(`${inbox.label} is not active at the relay.`);
    if (inbox.relay.routeStatus && inbox.relay.routeStatus !== 'synced') findings.push(`${inbox.label} has not reached the listener route yet.`);
    if (
      inbox.relay.state === 'verified' &&
      inbox.relay.groupTopicCount !== undefined &&
      inbox.relay.groupTopicCount !== inbox.groupTopicCount
    ) {
      findings.push(`${inbox.label} has ${inbox.groupTopicCount} local conversation topic(s), but the relay has ${inbox.relay.groupTopicCount}. Re-register this inbox.`);
    }
    if (
      inbox.relay.state === 'verified' &&
      inbox.relay.hmacEpochCount !== undefined &&
      inbox.relay.hmacEpochCount !== inbox.hmacEpochCount
    ) {
      findings.push(`${inbox.label} has ${inbox.hmacEpochCount} local HMAC epoch(s), but the relay has ${inbox.relay.hmacEpochCount}. Re-register this inbox.`);
    }
  }
  if (relay.deliveryReadiness !== 'ready') findings.push('The public XMTP delivery pipeline is not reporting ready.');

  const latestActivity = activities.reduce<number | undefined>(
    (latest, entry) => latest === undefined || entry.receivedAt > latest ? entry.receivedAt : latest,
    undefined,
  );
  return {
    checkedAt: new Date().toISOString(),
    permission,
    serviceWorker: {
      registered: Boolean(browser.registration),
      scope: registrationScope(browser.registration),
      state: registrationWorkerState(browser.registration),
    },
    browserSubscription: {
      present: Boolean(browser.subscription),
      providerHost: providerHost(endpoint),
      expiresAt: browser.subscription?.expirationTime,
    },
    app,
    relay,
    inboxes: diagnostics,
    staleRegistrationCount: staleCount,
    lastActivityAt: latestActivity,
    lastDiagnosticReceipt,
    activeConversationCount,
    findings,
  };
}

export async function testLocalPushNotificationDisplay(): Promise<PushDiagnosticReceipt> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    throw new Error('Allow site notifications before testing browser display.');
  }
  const registration = await ensurePushServiceWorkerRegistration();
  const worker = registration.active;
  if (!worker) throw new Error('The Converge service worker is not active.');
  const testId = globalThis.crypto.randomUUID();
  const channel = new MessageChannel();
  return new Promise<PushDiagnosticReceipt>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The service worker did not confirm the display test.')), 5_000);
    channel.port1.onmessage = (event) => {
      const data = objectValue(event.data);
      if (data?.type === 'converge.push.diagnostic-error') {
        clearTimeout(timeout);
        reject(new Error(stringValue(data.message) || 'Notification display failed.'));
        return;
      }
      if (data?.type !== 'converge.push.diagnostic' || data.testId !== testId) return;
      clearTimeout(timeout);
      const receivedAt = typeof data.receivedAt === 'number' ? data.receivedAt : Date.now();
      resolve({ testId, receivedAt, source: 'local' });
    };
    worker.postMessage({ type: 'converge.push.test-display', testId }, [channel.port2]);
  });
}

export function listenForPushDiagnosticReceipt(
  listener: (receipt: PushDiagnosticReceipt) => void,
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const handleMessage = (event: MessageEvent) => {
    const data = objectValue(event.data);
    const testId = stringValue(data?.testId);
    const source: PushDiagnosticReceipt['source'] | undefined =
      data?.source === 'local' || data?.source === 'relay' ? data.source : undefined;
    if (data?.type !== DIAGNOSTIC_RECEIPT_EVENT || !testId || !source) return;
    const receivedAt = typeof data.receivedAt === 'number' ? data.receivedAt : Date.now();
    const receipt: PushDiagnosticReceipt = { testId, receivedAt, source };
    void getPushStateStore().putLastDiagnosticReceipt(receipt).catch(() => undefined);
    listener(receipt);
  };
  navigator.serviceWorker.addEventListener('message', handleMessage);
  return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
}

export async function waitForRelayPushDiagnosticReceipt(
  testId: string,
  options: {
    stateStore?: PushStateStore;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<PushDiagnosticReceipt> {
  const stateStore = options.stateStore ?? getPushStateStore();
  const timeoutMs = options.timeoutMs ?? 12_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + Math.max(1, timeoutMs);
  for (;;) {
    const receipt = await stateStore.getLastDiagnosticReceipt();
    if (receipt?.source === 'relay' && receipt.testId === testId) return receipt;
    if (Date.now() >= deadline) {
      throw new Error('The relay queued the test, but this service worker did not confirm notification display in time.');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, pollIntervalMs)));
  }
}

export async function currentRelayDiagnosticRegistration(
  stateStore: PushStateStore = getPushStateStore(),
): Promise<CachedInboxPushRegistration | undefined> {
  const currentInboxId = normalizeInboxId(useAuthStore.getState().identity?.inboxId);
  if (!currentInboxId) return undefined;
  const [preferences, registrations] = await Promise.all([
    stateStore.getPreferences(),
    stateStore.listRegistrations(),
  ]);
  const browser = await getBrowserPushSubscriptionState(preferences.endpoint);
  return registrations
    .filter((entry) =>
      !entry.pendingDeletion &&
      normalizeInboxId(entry.identity.inboxId) === currentInboxId &&
      entry.endpoint === browser.subscription?.endpoint
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}
