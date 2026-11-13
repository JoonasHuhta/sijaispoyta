// Sijaispöydän service worker: näyttää push-ilmoitukset myös silloin, kun sovellus on kiinni.
// Ei välimuistia, jotta uusi versio näkyy aina heti.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Sijaispöytä', {
    body: data.body || 'Sijaispöydässä on uusi ilmoitus.',
    icon: 'img/icon-192.png',
    badge: 'img/favicon.png',
    tag: data.tag,
    lang: 'fi',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        try { await client.navigate(target); } catch { /* esim. Safari */ }
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
