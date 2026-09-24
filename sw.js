// 앱 설치(PWA)용 서비스 워커. 인터넷이 되면 항상 새 파일을 먼저 받고(화면과 엔진 버전이 섞이지 않게),
// 안 되면 저장해 둔 파일로 혼자 하기를 계속한다. 다른 출처(Supabase·CDN·폰트)는 건드리지 않는다
const CACHE = 'holdem-v1';
const CHIPS = [100, 500, 1000, 5000, 25000].flatMap(v => [0, 1].map(i => `./assets/chips/chip-${v}-${i}.png`));
const CORE = ['./', './index.html', './engine.js', './manifest.webmanifest', './assets/room.jpg', './assets/felt.jpg', './icons/icon-192.png', ...CHIPS];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
