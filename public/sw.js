// Service worker Task Carousel (§9): кэш статического app shell.
// /api и /cdn-cgi никогда не кэшируются. Стратегия обновления:
//   - хэшированные /assets/* иммутабельны → cache-first;
//   - навигации → network-first, чтобы редирект Cloudflare Access на повторный
//     вход не скрывался кешированной оболочкой; shell — только offline fallback;
//   - нехэшированные ресурсы (/icon.svg, /manifest.webmanifest)
//     → stale-while-revalidate.

const CACHE_NAME = 'task-carousel-v1';

self.addEventListener('install', (event) => {
  // Прекэшируем shell '/' сразу, чтобы офлайн работал уже с первого визита.
  // /assets/* версионируются хэшем в имени и докэшируются on-fetch — их не трогаем.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch('/', { credentials: 'same-origin' });
        if (cacheable(res)) await cache.put('/', res.clone());
      } catch {
        // сеть/логин недоступны на этапе install — не критично, докэшируем позже
      }
      self.skipWaiting();
    })(),
  );
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
  // Кэшируем только успешные несредиректнутые ответы. Редирект Cloudflare Access
  // на страницу логина (redirected/opaqueredirect) кэшировать нельзя.
  return (
    response &&
    response.ok &&
    response.status === 200 &&
    response.type !== 'opaqueredirect' &&
    !response.redirected
  );
}

// Stale-while-revalidate: кэш немедленно (если есть), сеть догоняет кэш в фоне.
async function staleWhileRevalidate(event, request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);

  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) void cache.put(cacheKey, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network); // фоновое обновление кэша к следующему запуску
    return cached;
  }

  const response = await network;
  if (response) return response;
  // Офлайн и нет прямого кэша: для навигации падаем на shell '/'.
  const shell = await cache.match('/');
  return shell ?? Response.error();
}

// Навигация сначала идёт в сеть. В частности, opaqueredirect от Cloudflare
// Access должен вернуться браузеру: тогда он откроет страницу повторного входа.
// Кешированный shell допустим только при реальном сетевом исключении.
async function networkFirstNavigation(event, request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      event.waitUntil(cache.put('/', response.clone()));
    }
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API — только сеть
  if (url.pathname.startsWith('/cdn-cgi/')) return; // Cloudflare Access — только сеть

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event, request));
    return;
  }

  // Хэшированные ассеты иммутабельны → cache-first с докэшированием.
  if (url.pathname.startsWith('/assets/')) {
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
    return;
  }

  event.respondWith(staleWhileRevalidate(event, request, request));
});
