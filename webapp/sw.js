/**
 * sw.js — Service Worker para PWA offline
 * Estrategia: Cache-first para assets estáticos, Network-first para APIs Google.
 */

const CACHE_NAME    = 'orthowell-v3.2';
const CDN_CACHE     = 'orthowell-cdn-v2.6';
const IMAGES_CACHE  = 'orthowell-images-v2.6';

// Assets del app shell que se cachean en la instalación
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/ui.js',
  './js/auth.js',
  './js/sync.js',
  './js/catalog.js',
  './js/cotizar.js',
  './js/pdf.js',
  './js/app.js',
  './manifest.json',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// CDN assets (jsPDF, SheetJS, Google Fonts)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&family=Barlow+Condensed:wght@600;700;800&display=swap',
];

// ── INSTALL: cachear app shell ────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('SW: some static assets failed to cache', err);
        });
      }),
      caches.open(CDN_CACHE).then(cache => {
        return cache.addAll(CDN_ASSETS).catch(err => {
          console.warn('SW: CDN assets not cached (offline at install time)', err);
        });
      }),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos ──────────────────────────────
self.addEventListener('activate', event => {
  const currentCaches = [CACHE_NAME, CDN_CACHE, IMAGES_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => !currentCaches.includes(name))
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de request ────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google APIs: Network only (necesitan auth token)
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('accounts.google.com') ||
      url.hostname.includes('oauth2.googleapis.com')) {
    return; // No interceptar — dejar pasar directamente
  }

  // Google Drive thumbnails: Cache first (imágenes de productos)
  if (url.hostname === 'drive.google.com' && url.pathname.includes('thumbnail')) {
    event.respondWith(cacheFirstWithFallback(event.request, IMAGES_CACHE));
    return;
  }

  // lh3.googleusercontent.com (Drive CDN de imágenes)
  if (url.hostname === 'lh3.googleusercontent.com') {
    event.respondWith(cacheFirstWithFallback(event.request, IMAGES_CACHE));
    return;
  }

  // CDN assets (jsPDF, SheetJS, fonts): Cache first
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirstWithFallback(event.request, CDN_CACHE));
    return;
  }

  // Wikipedia / Wikimedia (búsqueda de imágenes): Network first, no cache
  if (url.hostname.includes('wikipedia.org') ||
      url.hostname.includes('wikimedia.org') ||
      url.hostname.includes('unsplash.com')) {
    return; // Dejar pasar directamente
  }

  // App shell (HTML, CSS, JS propios): Cache first con fallback a red
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithFallback(event.request, CACHE_NAME));
    return;
  }
});

// ── ESTRATEGIA: Cache-first con fallback a red ────────────────────
async function cacheFirstWithFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && request.method === 'GET') {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch(err) {
    // Si es HTML principal y estamos offline, devolver index del cache
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// ── MENSAJE: forzar actualización ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_IMAGE_CACHE') {
    caches.delete(IMAGES_CACHE).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});
