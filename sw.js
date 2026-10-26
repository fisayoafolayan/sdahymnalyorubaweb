const CACHE = 'sda-hymnal-yoruba-__BUILD_HASH__';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/hymns.json',
  '/manifest.json'
];

// Fonts are self-hosted now, so the app has no cross-origin dependencies left.
const CACHEABLE_ORIGINS = [self.location.origin];

// On a dev origin the shell must never be served from cache, or a stale copy hides your
// edits — the trap that previously had to be worked around by unregistering the worker
// entirely (which also cost the app its PWA installability). Production is unaffected:
// build.js rotates the cache name on every build, so a stale cache can't survive a deploy.
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

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

  // Navigation requests.
  if (isNavigate(e.request)) {
    const pathname = new URL(e.request.url).pathname;
    const isRoot = pathname === '/' || pathname === '/index.html';
    const isHymn = pathname.startsWith('/hymn/');

    e.respondWith(
      caches.open(CACHE).then(cache => {
        if (DEV) {
          // Dev: always go to the network; the cache is only an offline fallback.
          return fetch(e.request).catch(() => cache.match('/'));
        }
        if (isRoot) {
          // App shell: stale-while-revalidate for instant load.
          return cache.match('/').then(cached => {
            const fetchPromise = fetch(e.request).then(response => {
              if (response && response.status === 200) {
                cache.put('/', response.clone());
              }
              return response;
            }).catch(() => cached);
            return cached || fetchPromise;
          });
        }
        if (isHymn) {
          // Prerendered hymn pages: network-first for fresh content, falling back to the
          // cached app shell offline (the SPA re-renders the hymn from the URL path).
          return fetch(e.request).catch(() => cache.match('/'));
        }
        // Standalone pages (e.g., /privacy) -- fetch directly.
        return fetch(e.request);
      })
    );
    return;
  }

  // All other GET requests: cache-first in production, network-first on a dev origin.
  e.respondWith(
    caches.open(CACHE).then(cache => {
      if (DEV) {
        return fetch(e.request).then(response => {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => cache.match(e.request));
      }
      return cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      });
    })
  );
});
