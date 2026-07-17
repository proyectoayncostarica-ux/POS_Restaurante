const MUNDIPOS_SW_VERSION = 'v3.2.5-service-finalization';
const APP_SHELL_CACHE = `mundipos-shell-${MUNDIPOS_SW_VERSION}`;
const RUNTIME_CACHE = `mundipos-runtime-${MUNDIPOS_SW_VERSION}`;

const APP_SHELL_URLS = [
  '/POS/',
  '/POS/index.html',
  '/POS/offline.html',
  '/POS/manifest.webmanifest',
  '/POS/favicon.ico',
  '/POS/css/style.css',
  '/POS/css/style.css?v=3.2.5-service-finalization',
  '/POS/js/services/operational-access.js',
  '/POS/js/services/operational-access.js?v=3.2.5-service-finalization',
  '/POS/js/main.js',
  '/POS/js/main.js?v=3.2.5-service-finalization',
  '/POS/js/components/dashboard.js',
  '/POS/js/components/dashboard.js?v=3.2.5-service-finalization',
  '/POS/js/components/tables.js',
  '/POS/js/components/tables.js?v=3.2.5-service-finalization',
  '/POS/js/components/menu.js',
  '/POS/js/components/menu.js?v=3.2.5-service-finalization',
  '/POS/js/components/orders.js',
  '/POS/js/components/orders.js?v=3.2.5-service-finalization',
  '/POS/js/components/accounts.js',
  '/POS/js/components/accounts.js?v=3.2.5-service-finalization',
  '/POS/js/components/cash.js',
  '/POS/js/components/cash.js?v=3.2.5-service-finalization',
  '/POS/js/components/users.js',
  '/POS/js/components/users.js?v=3.2.5-service-finalization',
  '/POS/js/components/settings.js',
  '/POS/js/components/settings.js?v=3.2.5-service-finalization',
  '/POS/assets/brand/mundipos-mark.png',
  '/POS/assets/icons/mundipos-icon-192.png',
  '/POS/assets/icons/mundipos-maskable-192.png',
  '/POS/assets/icons/mundipos-icon-512.png',
  '/POS/assets/icons/mundipos-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    cacheShellFiles()
      .catch(error => console.warn('MundiPOS PWA: precaché parcial.', error))
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
      .catch(error => console.warn('MundiPOS PWA: limpieza de caché parcial.', error))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (!request || request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(respondSafely(request, url));
});

async function respondSafely(request, url) {
  try {
    let response;

    if (url.pathname.startsWith('/api/')) {
      response = await networkOnly(request);
    } else if (request.mode === 'navigate') {
      response = await navigationHandler(request, url);
    } else if (url.pathname.startsWith('/POS/css/') || url.pathname.startsWith('/POS/js/')) {
      response = await networkFirstAsset(request);
    } else if (url.pathname.startsWith('/POS/')) {
      response = await staleWhileRevalidate(request);
    } else {
      response = await fetch(request);
    }

    return ensureResponse(response, request);
  } catch (error) {
    console.warn('MundiPOS PWA: respuesta fallback por error en fetch.', error);
    return emergencyFallback(request);
  }
}

async function cacheShellFiles() {
  const cache = await caches.open(APP_SHELL_CACHE);
  const results = await Promise.allSettled(
    APP_SHELL_URLS.map(async assetUrl => {
      const response = await fetch(assetUrl, { cache: 'reload' });
      if (isCacheableResponse(response)) {
        await cache.put(assetUrl, response.clone());
      }
    })
  );

  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    console.warn('MundiPOS PWA: algunos assets no se pudieron precachear.', failures.map(f => f.reason?.message || f.reason));
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return jsonUnavailableResponse();
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request, { cache: 'no-store', redirect: 'follow' });

    if (isCacheableResponse(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put('/POS/', response.clone()).catch(() => null);
    }

    return response;
  } catch (error) {
    return navigationFallback(request);
  }
}

async function networkFirstAsset(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });

    if (isCacheableResponse(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone()).catch(() => null);
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request).catch(() => null);
    if (cached) return cached;
    return emergencyFallback(request);
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request).catch(() => null);
  if (cached) {
    fetchAndCache(request).catch(() => null);
    return cached;
  }

  try {
    return await fetchAndCache(request);
  } catch (error) {
    return emergencyFallback(request);
  }
}

async function fetchAndCache(request) {
  const response = await fetch(request);

  if (isCacheableResponse(response)) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone()).catch(() => null);
  }

  return response;
}

async function navigationFallback(request) {
  const cachedNavigation = await caches.match('/POS/').catch(() => null);
  if (cachedNavigation) return cachedNavigation;

  const cachedIndex = await caches.match('/POS/index.html').catch(() => null);
  if (cachedIndex) return cachedIndex;

  const offline = await caches.match('/POS/offline.html').catch(() => null);
  if (offline) return offline;

  return new Response(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MundiPOS sin conexión</title>
</head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #203247;">
  <h1>MundiPOS no está disponible</h1>
  <p>No se pudo conectar con el servidor local. Reinicia la aplicación e inténtalo de nuevo.</p>
</body>
</html>`, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function emergencyFallback(request) {
  const destination = request.destination || '';
  let pathname = '';

  try {
    pathname = new URL(request.url).pathname;
  } catch (error) {
    pathname = '';
  }

  if (request.mode === 'navigate' || destination === 'document') {
    return navigationFallback(request);
  }

  if (destination === 'style' || pathname.endsWith('.css')) {
    return new Response('/* MundiPOS: hoja de estilos no disponible temporalmente. */', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/css; charset=utf-8' }
    });
  }

  if (destination === 'script' || pathname.endsWith('.js')) {
    return new Response('console.warn("MundiPOS: script no disponible temporalmente.");', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
    });
  }

  if (pathname.startsWith('/api/')) {
    return jsonUnavailableResponse();
  }

  return new Response('MundiPOS no está disponible temporalmente.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function ensureResponse(response, request) {
  if (response instanceof Response) {
    return response;
  }

  return emergencyFallback(request);
}

function isCacheableResponse(response) {
  return response instanceof Response && response.ok && response.type === 'basic';
}

function jsonUnavailableResponse() {
  return new Response(JSON.stringify({ error: 'Servidor local no disponible temporalmente' }), {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
