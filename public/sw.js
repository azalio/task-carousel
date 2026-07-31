// Service worker Task Carousel (§9): кэш статического app shell.
// /api никогда не кэшируется; при офлайне навигация падает на кэшированный '/'.

const CACHE_NAME = 'task-carousel-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheable(response) {
  // Не кэшируем ошибки и редиректы (например, логин Cloudflare Access).
  return response.ok && !response.redirected && response.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API — только сеть
  if (url.pathname.startsWith('/cdn-cgi/')) return; // Cloudflare Access — только сеть

  // Навигация: сеть, при офлайне — кэшированный app shell '/'.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheable(response)) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)));
          }
          return response;
        })
        .catch(() =>
          caches.match('/').then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  // Статика: cache-first с докэшированием из сети.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (cacheable(response)) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        }),
    ),
  );
});
