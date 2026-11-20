/* MeshView service worker — caches the app shell for offline use */
const CACHE = 'meshview-v1.3.0';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.json',
  './js/vendor/three.min.js', './js/core.js', './js/geom.js', './js/motion.js', './js/viewer.js', './js/pick.js', './js/tools.js', './js/ui.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
