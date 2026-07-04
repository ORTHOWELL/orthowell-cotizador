/**
 * sw.js — Service Worker para PWA offline
 * Estrategia:
 *   - index.html → Network-first (siempre fresco, con fallback a caché si offline)
 *   - JS / CSS / imágenes propias → Cache-first (rápido, actualizados al instalar nuevo SW)
 *   - CDN (jsPDF, fonts) → Cache-first
 *   - Google APIs → Network-only (requieren auth token)
 */

const CACHE_NAME   = 'orthowell-v5.4';
const CDN_CACHE    = 'orthowell-cdn-v2.6';
const IMAGES_CACHE = 'orthowell-images-v2.9';

const STATIC_ASSETS = [
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/ui.js',
  './js/auth.js',
  './js/sync.js',
  './js/catalog.js',
  './js/cotizar.js',
  './js/pdf.js',
  './js/orders.js',
  './js/app.js',
  './manifest.json',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&family=Barlow+Condensed:wght@600;700;800&display=swap',
];

// ── INSTALL: cachear con no-cache para obtener versión fresca ─────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache =>
        Promise.all(
          STATIC_ASSETS.map(url =>
            fetch(new Request(url, { cache: 'no-cache' }))
              .then(r => { if (r.ok) cache.put(url, r); })
              .catch(() => {})
          )
        )
      ),
      caches.open(CDN_CACHE).then(cache =>
        cache.addAll(CDN_ASSETS).catch(() => {})
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos + notificar a clientes ────────
self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, CDN_CACHE, IMAGES_CACHE];
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => !keep.includes(n)).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de request ─────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google APIs: Network-only
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('accounts.google.com') ||
      url.hostname.includes('oauth2.googleapis.com')) {
    return;
  }

  // Drive / imágenes autenticadas: pasar sin cachear
  if (url.hostname === 'drive.google.com' ||
      url.hostname === 'lh3.googleusercontent.com') {
    return;
  }

  // CDN (jsPDF, fonts, html5-qrcode): Cache-first
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(event.request, CDN_CACHE));
    return;
  }

  // Wikipedia / Wikimedia / Unsplash: pasar sin cachear
  if (url.hostname.includes('wikipedia.org') ||
      url.hostname.includes('wikimedia.org') ||
      url.hostname.includes('unsplash.com')) {
    return;
  }

  if (url.origin === self.location.origin) {
    const path = url.pathname;
    const isHtml = path.endsWith('/') ||
                   path.endsWith('/index.html') ||
                   path === '/orthowell-cotizador/' ||
                   event.request.mode === 'navigate';

    if (isHtml) {
      // index.html: Network-first → siempre la versión más reciente
      event.respondWith(networkFirstHtml(event.request));
    } else {
      // JS, CSS, imágenes: Cache-first (rápido, renovado en cada instalación de SW)
      event.respondWith(cacheFirst(event.request, CACHE_NAME));
    }
  }
});

// ── Network-first para HTML (fallback a caché si offline) ─────────
async function networkFirstHtml(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) cache.put('./index.html', res.clone()).catch(() => {});
    return res;
  } catch(err) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    throw err;
  }
}

// ── Cache-first con fallback a red ────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok && request.method === 'GET') {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch(err) {
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// ── Mensajes desde la app ─────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_IMAGE_CACHE') {
    caches.delete(IMAGES_CACHE).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});
