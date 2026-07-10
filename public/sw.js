/* Minimal service worker for app-level, multi-inbox Web Push. */
const PUSH_STATE_DB_NAME = 'ConvergePushState';
const PUSH_STATE_DB_VERSION = 1;
const PUSH_META_STORE = 'meta';
const PUSH_REGISTRATIONS_STORE = 'registrations';
const PUSH_PROFILES_STORE = 'profiles';
const PUSH_ACTIVITY_STORE = 'activity';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPushData(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { type: 'xmtp.new_message' };
  }
}

function unwrapPayload(data) {
  if (data && typeof data === 'object' && data.payload && typeof data.payload === 'object') {
    return data.payload;
  }
  return data && typeof data === 'object' ? data : {};
}

function sameOriginUrl(value) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : '/';
  try {
    const url = new URL(candidate, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

function validInboxHandle(value) {
  if (typeof value !== 'string') return null;
  const handle = value.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(handle) ? handle : null;
}

function payloadInboxHandle(payload) {
  const nestedData = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return validInboxHandle(payload.inboxHandle) || validInboxHandle(nestedData.inboxHandle);
}

function openPushStateDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_STATE_DB_NAME, PUSH_STATE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PUSH_META_STORE)) {
        database.createObjectStore(PUSH_META_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(PUSH_REGISTRATIONS_STORE)) {
        database.createObjectStore(PUSH_REGISTRATIONS_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(PUSH_PROFILES_STORE)) {
        database.createObjectStore(PUSH_PROFILES_STORE, { keyPath: 'inboxHandle' });
      }
      if (!database.objectStoreNames.contains(PUSH_ACTIVITY_STORE)) {
        database.createObjectStore(PUSH_ACTIVITY_STORE, { keyPath: 'inboxHandle' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open push state database'));
  });
}

async function readInboxProfile(inboxHandle) {
  if (!inboxHandle) return undefined;
  const database = await openPushStateDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(PUSH_PROFILES_STORE, 'readonly')
        .objectStore(PUSH_PROFILES_STORE)
        .get(inboxHandle);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to read push profile'));
    });
  } finally {
    database.close();
  }
}

async function recordInboxActivity(inboxHandle, receivedAt) {
  if (!inboxHandle) return 1;
  const database = await openPushStateDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(PUSH_ACTIVITY_STORE, 'readwrite');
      const store = transaction.objectStore(PUSH_ACTIVITY_STORE);
      const getRequest = store.get(inboxHandle);
      let nextCount = 1;
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        nextCount = typeof existing?.count === 'number' ? existing.count + 1 : 1;
        store.put({ inboxHandle, receivedAt, count: nextCount });
      };
      getRequest.onerror = () => reject(getRequest.error || new Error('Unable to read push activity'));
      transaction.oncomplete = () => resolve(nextCount);
      transaction.onerror = () => reject(transaction.error || new Error('Unable to store push activity'));
      transaction.onabort = () => reject(transaction.error || new Error('Push activity transaction aborted'));
    });
  } finally {
    database.close();
  }
}

async function postActivityToClients(inboxHandle, receivedAt, count) {
  if (!inboxHandle) return;
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({
      type: 'converge.push.activity',
      inboxHandle,
      receivedAt,
      count,
    });
  }
}

function localProfileName(profile) {
  if (!profile || typeof profile.displayName !== 'string') return null;
  const displayName = profile.displayName.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return displayName || null;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = unwrapPayload(readPushData(event));
      const inboxHandle = payloadInboxHandle(payload);
      const receivedAt = Date.now();
      const [profile, count] = await Promise.all([
        readInboxProfile(inboxHandle).catch(() => undefined),
        recordInboxActivity(inboxHandle, receivedAt).catch(() => 1),
      ]);
      await postActivityToClients(inboxHandle, receivedAt, count).catch(() => undefined);

      const displayName = localProfileName(profile);
      const body = displayName ? `New activity for ${displayName}` : 'New activity';
      const url = sameOriginUrl(payload.url || payload.clickUrl || '/');
      const tag = inboxHandle
        ? `converge-xmtp-${inboxHandle}`
        : 'converge-xmtp-unresolved';

      await self.registration.showNotification('Converge', {
        body,
        tag,
        data: {
          url,
          type: 'xmtp.new_message',
          inboxHandle,
        },
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification?.data?.url || '/');
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && typeof client.navigate === 'function') {
            try {
              await client.navigate(url);
            } catch {
              // A focused client can still surface its pending inbox activity.
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
