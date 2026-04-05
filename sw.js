const CACHE = 'sda-hymnal-yoruba-v0.0.16';
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

function isNavigate(req) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept');
  return accept && accept.includes('text/html');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (!url.startsWith('http') || !isCacheable(url)) return;

  // Navigation requests: always serve cached root page
  if (isNavigate(e.request)) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match('/').then(cached => {
          const fetchPromise = fetch(e.request).then(response => {
            if (response && response.status === 200) {
              cache.put('/', response.clone());
            }
            return response;
          }).catch(() => cached);

          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // All other GET requests: cache-first
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    )
  );
});
