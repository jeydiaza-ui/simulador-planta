/* ============================================================
   Simulador de Planta CTC Energy · Service Worker
   Permite instalar la app y trabajar sin conexión.
   ============================================================ */
const CACHE = 'ctc-planta-v1.4.8';
const CORE = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/app.js',
  './assets/compartir.js',
  './assets/biblioteca.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(CORE.map(u => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navegación: red primero, y si no hay internet, la copia guardada
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copia)).catch(() => { });
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Recursos: caché primero y se actualiza por detrás
  ev.respondWith(
    caches.match(req).then(hit => {
      const red = fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => { });
        }
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
