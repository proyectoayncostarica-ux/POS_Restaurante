const MUNDIPOS_SW_VERSION = 'v2.2.4.6-fix1-admin-zones-visual';
const APP_SHELL_CACHE = `mundipos-shell-${MUNDIPOS_SW_VERSION}`;
const RUNTIME_CACHE = `mundipos-runtime-${MUNDIPOS_SW_VERSION}`;

const APP_SHELL_URLS = [
  '/POS/',
  '/POS/index.html',
  '/POS/offline.html',
  '/POS/manifest.webmanifest',
  '/POS/favicon.ico',
  '/POS/css/style.css',
  '/POS/css/style.css?v=2.2.4.6-fix1-admin-zones-visual',
  '/POS/js/main.js',
  '/POS/js/components/dashboard.js',
  '/POS/js/components/tables.js',
  '/POS/js/components/menu.js',
  '/POS/js/components/orders.js',
  '/POS/js/components/accounts.js',
  '/POS/js/components/users.js',
  '/POS/js/components/settings.js',
  '/POS/assets/brand/mundipos-mark.png',
  '/POS/assets/icons/mundipos-icon-192.png',
  '/POS/assets/icons/mundipos-maskable-192.png',
  '/POS/assets/icons/mundipos-icon-512.png',
  '/POS/assets/icons/mundipos-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cacheShellFiles(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith('mundipos-') && ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(cacheName))
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (url.pathname.startsWith('/POS/css/') || url.pathname.startsWith('/POS/js/')) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  if (url.pathname.startsWith('/POS/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheShellFiles(cache) {
  const results = await Promise.allSettled(
    APP_SHELL_URLS.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) {
        throw new Error(`${url} respondió ${response.status}`);
      }
      await cache.put(url, response);
    })
  );

  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    console.warn('MundiPOS PWA: algunos assets no se pudieron precachear.', failures.map(f => f.reason?.message || f.reason));
  }
}

async function networkOnly(request) {
  return fetch(request);
}

async function navigationHandler(request) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/POS')) {
    return fetch(request);
  }

  try {
    const response = await fetch(request, { cache: 'no-store', redirect: 'follow' });

    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put('/POS/', response.clone());
    }

    return response;
  } catch (error) {
    const cachedApp = await caches.match('/POS/');
    if (cachedApp) return cachedApp;

    const offline = await caches.match('/POS/offline.html');
    return offline || new Response('MundiPOS no está disponible sin conexión al servidor local.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}


async function networkFirstAsset(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/POS/offline.html');
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || caches.match('/POS/offline.html');
}
