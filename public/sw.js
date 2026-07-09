/* Minimal Service Worker for Web Push */
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
    if (url.origin !== self.location.origin) {
      return self.location.origin + '/';
    }
    return url.href;
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('push', (event) => {
  const data = readPushData(event);
  const payload = unwrapPayload(data);
  const nestedData = payload.data && typeof payload.data === 'object' ? payload.data : {};

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Converge';
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.trim()
      : 'New encrypted message';
  const url = sameOriginUrl(payload.url || payload.clickUrl || nestedData.url || '/');
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim()
      : 'converge-xmtp-notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: {
        url,
        type: typeof payload.type === 'string' ? payload.type : 'xmtp.new_message',
        conversationId:
          typeof payload.conversationId === 'string'
            ? payload.conversationId
            : typeof nestedData.conversationId === 'string'
              ? nestedData.conversationId
              : undefined,
      },
      icon: typeof payload.icon === 'string' ? payload.icon : '/icons/icon-192.png',
      badge: typeof payload.badge === 'string' ? payload.badge : '/icons/icon-192.png',
      requireInteraction: Boolean(payload.requireInteraction),
      silent: Boolean(payload.silent),
    })
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
            } catch {}
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
