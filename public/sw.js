/* PplosHR service worker. VERSION is bumped per release.
 * SECURITY: caches ONLY same-origin static build assets (/assets, icons, manifest) and a tiny offline page.
 * It never caches: non-GET requests, cross-origin requests (Apps Script API), HTML documents containing
 * session data, PDFs, or any attachment/payslip URL. Authenticated data is always network-only. */
const VERSION = 'pploshr-shell-v10-design';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/html2pdf.bundle.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

const isStaticAsset = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;               // never intercept writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept API / third-party
  if (req.mode === 'navigate') {
    // Network-first for the app shell; offline fallback page only (no cached authenticated content).
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
