/* Mi Librero — Service Worker
   Hace la app instalable y disponible sin conexión.
   Sube el número de versión cuando cambies index.html para forzar actualización. */

const VERSION = 'v5-9';
const SHELL_CACHE = 'librero-shell-' + VERSION;
const COVER_CACHE = 'librero-covers-' + VERSION;
const COVER_MAX = 300; // máximo de portadas guardadas

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './icon-180.png',
  './favicon-32.png'
];

// Dominios desde donde llegan las portadas (se cachean al verlas).
const COVER_HOSTS = [
  'covers.openlibrary.org',
  'books.google.com',
  'books.googleusercontent.com',
  'lh3.googleusercontent.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== COVER_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Permite actualizar de inmediato si la página lo pide.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }
}

function isCoverRequest(url) {
  return COVER_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1) Navegación (abrir la app): red primero, con respaldo al index cacheado.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 2) Portadas (otros dominios): usa caché y refresca en segundo plano.
  if (isCoverRequest(url)) {
    event.respondWith(
      caches.open(COVER_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone()).then(() => trimCache(COVER_CACHE, COVER_MAX)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3) Recursos propios (íconos, manifest, etc.): caché primero.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 4) Lo demás (p. ej. APIs de búsqueda): red directa; si falla, se ignora.
  // No interferimos para que las búsquedas online funcionen normal.
});
