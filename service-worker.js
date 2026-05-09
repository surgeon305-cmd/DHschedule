const CACHE = 'dh-cal-v9';
const STATIC_ASSETS = [
  '/DHschedule/icon-180.png',
  '/DHschedule/icon-192.png',
  '/DHschedule/icon-512.png',
  '/DHschedule/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      const oldKeys = keys.filter(k => k !== CACHE);
      return Promise.all(oldKeys.map(k => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          // 구버전 캐시가 존재했을 때만(= 실제 업데이트) 열린 창에 리로드 신호 발송
          if (oldKeys.length > 0) {
            return self.clients.matchAll({ type: 'window' })
              .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })));
          }
        });
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 외부 리소스 (Supabase, CDN 등): 네트워크 우선, 실패 시 캐시
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

  // HTML (앱 셸): 항상 네트워크 우선 → 배포 즉시 반영, 오프라인 시 캐시 fallback
  if (
    url.pathname.endsWith('.html') ||
    url.pathname === '/DHschedule/' ||
    url.pathname === '/DHschedule'
  ) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 정적 에셋 (아이콘, manifest): 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }))
  );
});
