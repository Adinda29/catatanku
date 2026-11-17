/* Catatku — service worker.
   Strategi: NETWORK-FIRST untuk file aplikasi → saat online selalu memakai versi
   terbaru dari GitHub; saat offline memakai salinan tersimpan.
   Naikkan VERSION setiap kali mengubah file aplikasi. */
const VERSION = 'catatku-v1.2.0';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' → lewati cache HTTP browser agar yang tersimpan benar-benar versi baru
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // API (POST) tidak pernah di-cache
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

  if (isFont) {                                           // font: cache-first
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(req)) ||
      fetch(req).then((res) => { c.put(req, res.clone()); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;

  // file aplikasi: network-first (cek ke server, pakai cache hanya jika offline)
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }
  })());
});
