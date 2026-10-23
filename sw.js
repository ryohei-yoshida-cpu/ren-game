// オフラインでも あそべるように ファイルを ほぞんする
// インターネットに つながっている ときは かならず さいしんの ファイルを つかう（ネットワーク ゆうせん）。
// ほぞんした ファイルは オフラインの ときだけ つかうので、ふるい ファイルと あたらしい ファイルが まざらない。
// ほぞんする ファイルの しゅるいを かえたら VERSION を あげる
const VERSION = 'v10';
const APP = 'app-' + VERSION;
const FONTS = 'fonts-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/strokes.js',
  './js/data.js',
  './js/voicebox.js',
  './js/sound.js',
  './js/hero.js',
  './js/medal.js',
  './js/cloud-config.js',
  './js/cloud.js',
  './js/game.js',
  './js/studio.js',
  './audio/voice/index.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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

  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    // ブラウザの キャッシュも かならず サーバーに たしかめる
    const res = await fetchWithTimeout(req.url, 5000);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || Response.error();
  }
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}
