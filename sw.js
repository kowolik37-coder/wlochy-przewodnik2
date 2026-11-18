const CACHE_NAME = 'wlochy-przewodnik-offline-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nie przechwytuj połączeń z Google Apps Script (czat AI wymaga sieci)
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  // Obsługa przewijania audio offline na iOS Safari (nagłówek Range)
  if (event.request.headers.has('range') && url.origin === self.location.origin) {
    event.respondWith(handleRangeRequest(event.request));
    return;
  }

  // Dla kafelków mapy OpenStreetMap: sieć z zapisem do cache, fallback do cache offline
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const networkResp = await fetch(event.request);
          if (networkResp.ok) cache.put(event.request, networkResp.clone());
          return networkResp;
        } catch (err) {
          const cached = await cache.match(event.request);
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Dla plików strony, bibliotek i MP3: najpierw z pamięci offline (cache), potem z sieci
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResp) => {
      if (cachedResp) return cachedResp;
      return fetch(event.request).then((networkResp) => {
        if (networkResp && networkResp.status === 200 && event.request.method === 'GET') {
          const copy = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResp;
      });
    })
  );
});

async function handleRangeRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  if (!cached) {
    return fetch(request);
  }

  const arrayBuffer = await cached.arrayBuffer();
  const rangeHeader = request.headers.get('range');
  const bytes = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);

  if (!bytes) {
    return new Response(arrayBuffer, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': arrayBuffer.byteLength }
    });
  }

  const start = Number(bytes[1]);
  const end = bytes[2] ? Number(bytes[2]) : arrayBuffer.byteLength - 1;
  const sliced = arrayBuffer.slice(start, end + 1);

  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${arrayBuffer.byteLength}`,
      'Content-Length': sliced.byteLength,
      'Accept-Ranges': 'bytes'
    }
  });
}
