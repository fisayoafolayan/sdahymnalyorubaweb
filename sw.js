const CACHE = 'sda-hymnal-yoruba-v0.0.15';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/hymns.json',
  '/manifest.json'
];

const CACHEABLE_ORIGINS = [
  self.location.origin,
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url) {
  return CACHEABLE_ORIGINS.some(origin => url.startsWith(origin));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (!url.startsWith('http') || !isCacheable(url)) return;

  // All requests: cache-first, then network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(cached => {
      if (cached) {
        // Return cache immediately, update in background
        fetch(e.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE).then(c => c.put(e.request, response));
          }
        }).catch(() => {});
        return cached;
      }

      // Not in cache - try network, cache the result
      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Last resort for navigation: serve cached root
        if (e.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
