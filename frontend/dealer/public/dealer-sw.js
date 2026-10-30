/*
 * Dealer app service worker (NFR-2): keeps the app itself loadable without internet.
 * Data never passes through this cache — the app saves the roster, stock and
 * offline entries itself (lib/offline-store.ts). API calls always go to the network.
 */
const CACHE = 'srms-dealer-v1';
const PAGES = ['/', '/stock', '/history', '/alerts', '/receipt'];

// Save every page and the scripts/styles it needs, so any tab opens offline.
async function precache() {
  const cache = await caches.open(CACHE);
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { credentials: 'same-origin' });
      if (!res.ok || res.redirected) continue; // signed out: nothing to save
      const html = await res.clone().text();
      await cache.put(page, res);
      const assets = new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g) || []);
      await Promise.all([...assets].map((a) => cache.add(a).catch(() => undefined)));
    } catch {
      /* offline during install: pages are saved as they are visited */
    }
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // In-app navigation data: when offline it fails and Next.js falls back to a full page load (served below).
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (req.mode === 'navigate') {
    // Network first (always the latest version online), saved page when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(url.pathname).then(
            (hit) => hit || new Response('<meta charset="utf-8"><p style="font:18px sans-serif;padding:2rem">इंटरनेट नहीं है / No internet.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
          ),
        ),
    );
    return;
  }

  // Build files have content hashes in their names, so a saved copy never goes stale.
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
