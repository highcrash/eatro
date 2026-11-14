/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// App files only. API calls always go to the network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface Note {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let note: Note = {};
  try {
    note = (event.data?.json() as Note) ?? {};
  } catch {
    note = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(note.title || 'EATRO Staff Chat', {
      body: note.body || 'A customer needs a reply.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: note.tag,
      data: { url: note.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          w.postMessage({ type: 'open', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
