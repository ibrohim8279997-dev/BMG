/* BMG service worker: makes the site installable and keeps a text-free offline page.
   It never touches /api or /admin-api (sessions, CSRF and money must always hit the server). */
const V = 'bmg-shell-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll([OFFLINE, '/logo-mark.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/admin-api/')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (/^\/(_next\/static|img|icons)\//.test(u.pathname)) {   // immutable assets: cache first
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(r, copy)); }
      return res;
    })));
  }
});
