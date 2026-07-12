#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const convergeOrigin = (process.env.CONVERGE_ORIGIN || 'https://converge.cv').replace(/\/$/, '');
const apiBase = (process.env.VAPID_PARTY_API_BASE || 'https://vapid.party/api').replace(/\/$/, '');
const ingestToken = process.env.VAPID_PARTY_INTERNAL_INGEST_TOKEN;
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || '/usr/bin/google-chrome';
const profilePath = path.join(tmpdir(), `converge-push-relay-${Date.now()}`);

if (!ingestToken) {
  throw new Error('Set VAPID_PARTY_INTERNAL_INGEST_TOKEN to run the live relay probe');
}

const base64url = (value) => Buffer.from(value).toString('base64url');
const hex32 = () => randomBytes(32).toString('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probeIdentity(label) {
  const installationId = hex32();
  return {
    label,
    inboxId: hex32(),
    installationId,
    inboxHandle: `probe_${randomUUID().replaceAll('-', '')}`,
    welcomeTopic: `/xmtp/mls/1/w-${installationId}/proto`,
    groupTopic: `/xmtp/mls/1/g-${hex32()}/proto`,
  };
}

async function expectResponse(response, context) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} failed with ${response.status}: ${text}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

function registrationPayload(identity, subscription) {
  const currentPeriod = Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));
  return {
    version: 1,
    app: { id: 'converge.cv', origin: convergeOrigin },
    identity: {
      inboxId: identity.inboxId,
      installationId: identity.installationId,
    },
    subscription,
    xmtp: {
      env: 'production',
      topicSource: 'conversations.hmacKeys',
      topics: [
        { topic: identity.welcomeTopic, hmacKeys: [] },
        {
          topic: identity.groupTopic,
          hmacKeys: [-1, 0, 1].map((offset) => ({
            epoch: String(currentPeriod + offset),
            key: base64url(randomBytes(32)),
          })),
        },
      ],
    },
    notification: { inboxHandle: identity.inboxHandle },
    preferences: { minimalPayloadOnly: true, plaintextPreview: false },
    userAgent: 'converge-live-push-relay-probe',
    registeredAt: new Date().toISOString(),
  };
}

function officialDelivery(identity, { idempotencyKey = randomUUID(), topic, shouldPush } = {}) {
  const contentTopic = topic || identity.welcomeTopic;
  return {
    idempotency_key: idempotencyKey,
    message: {
      content_topic: contentTopic,
      message: base64url(randomBytes(32)),
    },
    message_context: {
      message_type: contentTopic.includes('/w-') ? 'v3-welcome' : 'v3-conversation',
      ...(typeof shouldPush === 'boolean' ? { should_push: shouldPush } : {}),
    },
    installation: {
      id: identity.installationId,
      delivery_mechanism: { kind: 'apns', token: 'web-push-relay' },
      payload_format: 'v3',
    },
    subscription: {
      created_at: new Date().toISOString(),
      topic: contentTopic,
      is_silent: false,
    },
    payload_format: 'v3',
  };
}

async function registerRelay(identity, subscription) {
  return expectResponse(
    await fetch(`${apiBase}/xmtp/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationPayload(identity, subscription)),
    }),
    `register ${identity.label}`,
  );
}

async function deleteRelay(identity, endpoint) {
  return expectResponse(
    await fetch(`${apiBase}/xmtp/subscriptions`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        app: { id: 'converge.cv', origin: convergeOrigin },
        endpoint,
        identity: {
          inboxId: identity.inboxId,
          installationId: identity.installationId,
        },
        deletedAt: new Date().toISOString(),
      }),
    }),
    `delete ${identity.label}`,
  );
}

async function ingest(delivery) {
  return expectResponse(
    await fetch(`${apiBase}/internal/xmtp/envelopes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ingestToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(delivery),
    }),
    'internal XMTP delivery',
  );
}

async function notificationCount(page, inboxHandle) {
  return page.evaluate(async (handle) => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications())
      .filter((notification) => notification.tag === `converge-xmtp-${handle}`).length;
  }, inboxHandle);
}

async function waitForNotification(page, inboxHandle, expectedBody, timeout = 45_000) {
  await page.waitForFunction(
    async ({ handle, body }) => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications()).some((candidate) =>
        candidate.tag === `converge-xmtp-${handle}` && candidate.body === body
      );
    },
    { handle: inboxHandle, body: expectedBody },
    { timeout },
  );
  return {
    title: 'Converge',
    body: expectedBody,
    tag: `converge-xmtp-${inboxHandle}`,
  };
}

async function activityCount(page, inboxHandle) {
  return page.evaluate(async (handle) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ConvergePushState', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const get = database.transaction('activity', 'readonly').objectStore('activity').get(handle);
        get.onsuccess = () => {
          database.close();
          resolve(get.result?.count ?? 0);
        };
        get.onerror = () => reject(get.error);
      };
    });
  }, inboxHandle);
}

async function waitForActivity(page, inboxHandle, expectedCount, timeout = 45_000) {
  await page.waitForFunction(
    async ({ handle, count }) => {
      const request = indexedDB.open('ConvergePushState', 1);
      const activity = await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction('activity', 'readonly').objectStore('activity').get(handle);
          get.onsuccess = () => {
            database.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      });
      return activity?.count === count;
    },
    { handle: inboxHandle, count: expectedCount },
    { timeout },
  );
}

async function readProbeState(page, identities) {
  return page.evaluate(async (items) => {
    const registration = await navigator.serviceWorker.ready;
    const notifications = (await registration.getNotifications()).map((notification) => ({
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
      data: notification.data,
    }));
    const activity = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ConvergePushState', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const get = database.transaction('activity', 'readonly').objectStore('activity').getAll();
        get.onsuccess = () => {
          database.close();
          resolve(get.result);
        };
        get.onerror = () => reject(get.error);
      };
    });
    return {
      notifications: notifications.filter((notification) =>
        items.some((item) => notification.tag === `converge-xmtp-${item.inboxHandle}`)),
      activity,
    };
  }, identities);
}

const identities = [probeIdentity('alpha'), probeIdentity('beta')];
const context = await chromium.launchPersistentContext(profilePath, {
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  headless: true,
  // Playwright disables background networking by default, which can prevent
  // Chrome's push-service connection from receiving the real Web Push.
  ignoreDefaultArgs: ['--disable-background-networking'],
  args: ['--no-first-run', '--no-default-browser-check'],
});

let page;
let subscription;
const registered = [];
const observedNotifications = [];
const cleanupErrors = [];
let probeError;
let probeResult;

try {
  await context.grantPermissions(['notifications'], { origin: convergeOrigin });
  page = context.pages()[0] || await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(convergeOrigin, { waitUntil: 'domcontentloaded' });

  subscription = await page.evaluate(async ({ apiBase, identities }) => {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const keyResponse = await fetch(`${apiBase}/xmtp/vapid-public-key`);
    if (!keyResponse.ok) throw new Error(`VAPID key request failed: ${keyResponse.status}`);
    const keyJson = await keyResponse.json();
    const publicKey = keyJson?.data?.publicKey || keyJson?.publicKey;
    const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
    const raw = atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const applicationServerKey = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
    const created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('ConvergePushState', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const [name, keyPath] of [
          ['meta', 'key'],
          ['registrations', 'key'],
          ['profiles', 'inboxHandle'],
          ['activity', 'inboxHandle'],
        ]) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('profiles', 'readwrite');
        const store = transaction.objectStore('profiles');
        for (const identity of identities) {
          store.put({
            inboxHandle: identity.inboxHandle,
            inboxId: identity.inboxId,
            displayName: `Push Probe ${identity.label}`,
            updatedAt: Date.now(),
          });
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    const json = created.toJSON();
    return {
      endpoint: json.endpoint,
      expirationTime: json.expirationTime,
      keys: json.keys,
    };
  }, { apiBase, identities });

  for (const identity of identities) {
    await registerRelay(identity, subscription);
    registered.push(identity);
  }

  const firstKey = randomUUID();
  await ingest(officialDelivery(identities[0], { idempotencyKey: firstKey }));
  await waitForActivity(page, identities[0].inboxHandle, 1);
  observedNotifications.push(await waitForNotification(
    page,
    identities[0].inboxHandle,
    `New activity for Push Probe ${identities[0].label}`,
  ));

  await ingest(officialDelivery(identities[0], { idempotencyKey: firstKey }));
  await delay(7_000);
  if (await activityCount(page, identities[0].inboxHandle) !== 1) {
    throw new Error('Duplicate delivery incremented the persisted activity count');
  }

  await ingest(officialDelivery(identities[1], {
    topic: identities[1].groupTopic,
    shouldPush: false,
  }));
  await delay(7_000);
  if (await notificationCount(page, identities[1].inboxHandle) !== 0) {
    throw new Error('shouldPush=false produced a visible notification');
  }

  const deletedAlpha = await deleteRelay(identities[0], subscription.endpoint);
  if (deletedAlpha?.data?.disabled !== true && deletedAlpha?.disabled !== true) {
    throw new Error(`Alpha relay deletion was not confirmed: ${JSON.stringify(deletedAlpha)}`);
  }
  registered.splice(registered.indexOf(identities[0]), 1);

  const deletedAlphaDelivery = await ingest(officialDelivery(identities[0]));
  if ((deletedAlphaDelivery?.data?.queued ?? deletedAlphaDelivery?.queued) !== 0) {
    throw new Error('A deleted logical registration still queued a push');
  }
  await delay(7_000);
  if (await activityCount(page, identities[0].inboxHandle) !== 1) {
    throw new Error('A deleted logical registration still reached the service worker');
  }

  await ingest(officialDelivery(identities[1]));
  await waitForActivity(page, identities[1].inboxHandle, 1);
  observedNotifications.push(await waitForNotification(
    page,
    identities[1].inboxHandle,
    `New activity for Push Probe ${identities[1].label}`,
  ));

  await ingest(officialDelivery(identities[1], {
    topic: identities[1].groupTopic,
    shouldPush: true,
  }));
  await waitForActivity(page, identities[1].inboxHandle, 2);
  // Chrome briefly removes an existing same-tag notification while replacing
  // it, whereas the service worker commits activity before showNotification.
  await delay(500);
  observedNotifications.push(await waitForNotification(
    page,
    identities[1].inboxHandle,
    `New activity for Push Probe ${identities[1].label}`,
  ));

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join('; ')}`);
  const state = await readProbeState(page, identities);

  const deletedBeta = await deleteRelay(identities[1], subscription.endpoint);
  if (deletedBeta?.data?.disabled !== true && deletedBeta?.disabled !== true) {
    throw new Error(`Beta relay deletion was not confirmed: ${JSON.stringify(deletedBeta)}`);
  }
  registered.splice(registered.indexOf(identities[1]), 1);

  probeResult = {
    success: true,
    browserEndpointHost: new URL(subscription.endpoint).host,
    checks: {
      sharedBrowserSubscription: true,
      welcomeDelivery: true,
      groupDelivery: true,
      duplicateSuppression: true,
      shouldPushSuppression: true,
      deleteOneKeepsOther: true,
      deletedRegistrationStopsDelivery: true,
      opaqueInboxActivity: true,
      localNotificationCopy: true,
    },
    state: { ...state, observedNotifications },
  };
} catch (error) {
  probeError = error;
} finally {
  for (const identity of registered) {
    if (!subscription?.endpoint) continue;
    let removed = false;
    for (let attempt = 0; attempt < 3 && !removed; attempt += 1) {
      removed = await deleteRelay(identity, subscription.endpoint)
        .then((result) => (result?.data?.disabled ?? result?.disabled) === true)
        .catch(() => false);
      if (!removed) await delay(500 * (attempt + 1));
    }
    if (!removed) {
      cleanupErrors.push(new Error(`Failed to clean relay registration for ${identity.label}`));
    }
  }
  if (page) {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const activeSubscription = await registration?.pushManager.getSubscription();
      if (activeSubscription && !(await activeSubscription.unsubscribe())) {
        throw new Error('Browser PushSubscription unsubscribe returned false');
      }
      for (const notification of await registration?.getNotifications() || []) notification.close();
      if (registration && !(await registration.unregister())) {
        throw new Error('Service worker unregister returned false');
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('ConvergePushState');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Push state deletion failed'));
        request.onblocked = () => reject(new Error('Push state deletion was blocked'));
      });
    }).catch((error) => {
      cleanupErrors.push(new Error(`Browser push cleanup failed: ${String(error)}`));
    });
  }
  await context.close().catch((error) => {
    cleanupErrors.push(new Error(`Browser close failed: ${String(error)}`));
  });
  await rm(profilePath, { recursive: true, force: true }).catch((error) => {
    cleanupErrors.push(new Error(`Browser profile cleanup failed: ${String(error)}`));
  });
}

if (probeError || cleanupErrors.length > 0) {
  throw new AggregateError(
    [probeError, ...cleanupErrors].filter(Boolean),
    cleanupErrors.length > 0
      ? `Live push relay probe failed cleanup (${cleanupErrors.length} error${cleanupErrors.length === 1 ? '' : 's'})`
      : 'Live push relay probe failed',
  );
}

process.stdout.write(`${JSON.stringify(probeResult, null, 2)}\n`);
