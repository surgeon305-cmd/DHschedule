const CACHE = 'dh-cal-v12';
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
      fetch(e.request, { cache: 'reload' }) // 브라우저 HTTP 캐시 우회 → 항상 최신 HTML
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

// ── Web Push 수신 → 알림 표시 ──
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (_) { data = { body: e.data ? e.data.text() : '' }; }
  const title = data.title || '도희 · 효중 캘린더';
  const options = {
    body:  data.body || '',
    icon:  '/DHschedule/icon-192.png',
    badge: '/DHschedule/icon-192.png',
    tag:   data.tag || undefined,          // 같은 tag면 알림 덮어씀 (중복 방지)
    data:  { url: data.url || '/DHschedule/' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── 알림 탭 → 앱 열기(이미 열려 있으면 포커스) ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/DHschedule/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/DHschedule') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
