const CACHE = 'dh-cal-v3';
const ASSETS = [
  '/DHschedule/',
  '/DHschedule/index.html',
  '/DHschedule/manifest.json',
  '/DHschedule/icon-180.png',
  '/DHschedule/icon-192.png',
  '/DHschedule/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 네트워크 우선: Supabase, 외부 CDN, API
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('jsdelivr') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('corsproxy') ||
    url.hostname.includes('aviationstack')
  ) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // 캐시 우선: 로컬 에셋
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }))
  );
});
