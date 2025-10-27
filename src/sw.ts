/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

type PrecacheEntry = { url: string; revision?: string } | string;

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: PrecacheEntry[];
};

const NAVIGATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

async function withIsolationHeaders(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);

  Object.entries(NAVIGATION_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  if (response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const clone = response.clone();
  const body = await clone.blob();

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const appShellStrategy = new NetworkFirst({
  cacheName: 'app-shell',
  networkTimeoutSeconds: 3,
  plugins: [
    new ExpirationPlugin({
      maxEntries: 50,
      maxAgeSeconds: 60 * 60 * 24,
    }),
  ],
});

registerRoute(
  ({ url }: { url: URL }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await appShellStrategy.handle(event);

          if (response) {
            return withIsolationHeaders(response);
          }
        } catch (error) {
          console.warn('Navigation request failed, attempting fallback', error);
        }

        const fallbackResponse =
          (await caches.match('/index.html', { ignoreSearch: true })) ||
          (await caches.match('index.html', { ignoreSearch: true }));

        if (fallbackResponse) {
          return withIsolationHeaders(fallbackResponse);
        }

        return Response.error();
      })()
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

export {};
