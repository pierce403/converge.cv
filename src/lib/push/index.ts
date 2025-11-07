export type PushSubscriptionDTO = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const VAPID_PUBLIC = import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined;
const PUSH_API_BASE = import.meta.env?.VITE_PUSH_API_BASE as string | undefined;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerServiceWorkerForPush(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Push] Service workers are not supported');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn('[Push] Failed to register service worker', e);
    return null;
  }
}

export async function enablePush(inboxId: string, installationId?: string): Promise<PushSubscriptionDTO | null> {
  if (!VAPID_PUBLIC) {
    console.warn('[Push] VITE_VAPID_PUBLIC_KEY is not set — cannot subscribe');
    return null;
  }
  const reg = await registerServiceWorkerForPush();
  if (!reg) return null;

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    console.warn('[Push] Notification permission not granted');
    return null;
  }

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const dto = existing.toJSON() as unknown as PushSubscriptionDTO;
    await registerWithBackend(inboxId, dto, installationId);
    return dto;
  }

  const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
  const dto = sub.toJSON() as unknown as PushSubscriptionDTO;
  await registerWithBackend(inboxId, dto, installationId);
  return dto;
}

export async function disablePush(inboxId: string): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
  try {
    if (PUSH_API_BASE) {
      await fetch(`${PUSH_API_BASE.replace(/\/$/, '')}/push/register`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inboxId, endpoint: sub.endpoint }),
      });
    }
  } catch (e) {
    console.warn('[Push] Failed to unregister backend', e);
  }
}

async function registerWithBackend(inboxId: string, subscription: PushSubscriptionDTO, installationId?: string) {
  if (!PUSH_API_BASE) {
    console.warn('[Push] VITE_PUSH_API_BASE not set — not sending subscription to backend');
    console.log('[Push] Subscription DTO:', { inboxId, installationId, subscription });
    return;
  }
  await fetch(`${PUSH_API_BASE.replace(/\/$/, '')}/push/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inboxId, installationId, subscription, userAgent: navigator.userAgent }),
  });
}
