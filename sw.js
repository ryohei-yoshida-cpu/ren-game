// オフラインでも あそべるように ファイルを ほぞんする
// ほぞんする ファイルの しゅるいを かえたら VERSION を あげる
const VERSION = 'v1';
const APP = 'app-' + VERSION;
const FONTS = 'fonts-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/strokes.js',
  './js/data.js',
  './js/sound.js',
  './js/hero.js',
  './js/medal.js',
  './js/game.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: いちど よんだら ほぞん
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // じぶんの ファイル: ほぞんぶんを すぐ かえし、うらで あたらしいのに こうしん
  // （つぎに ひらいたときに さいしんばんに なる）
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(APP).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const update = fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    if (hit) {
      e.waitUntil(update);
      return hit;
    }
    return update;
  }));
});
