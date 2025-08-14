/* Service worker for Prep & Par static app */
const CACHE_NAME = 'prep-par-cache-v1';
const PRECACHE_URLS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});