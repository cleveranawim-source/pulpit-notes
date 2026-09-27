// 강단노트 서비스워커 — 인터넷 없이도 열리도록 앱 파일을 보관한다.
// 앱 파일을 고치면 VERSION 을 올릴 것(구 캐시 정리).
const VERSION = 'pn-v4';
const SHELL = [
  './', 'index.html', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js',
  'fonts/GowunBatang-Regular.woff2', 'fonts/GowunBatang-Bold.woff2', 'sample/sample.pdf',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => { if (res.ok || res.type === 'opaque') caches.open(VERSION).then(c => c.put(req, res)); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 라이브러리·글꼴·예시 원고: 한 번 받으면 캐시에서
  if (/\/(vendor|fonts|sample)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res.clone()) && res)));
    return;
  }
  if (url.origin !== location.origin) return;

  // 앱 파일: 새 버전 우선, 3초 안에 안 오면(또는 오프라인이면) 보관본
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then(hit => {
      if (done) return;
      if (hit) { done = true; resolve(hit); }
    });
    const timer = setTimeout(fallback, 3000);
    fetch(req).then(res => {
      clearTimeout(timer);
      put(req, res.clone());
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      caches.match(req, { ignoreSearch: true }).then(hit => {
        if (!done) { done = true; resolve(hit || Response.error()); }
      });
    });
  }));
});
