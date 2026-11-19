/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * ServiceWorker.js
 * --------------------------------------------------------------------------
 * 1. 離線快取：程式檔「網路優先、失敗用快取」；Engine 核心檔「快取優先」
 * 2. 跨來源隔離：為同源回應補上 COOP／COEP／CORP 標頭，
 *    讓 GitHub Pages 等無法自訂標頭的空間也能啟用 SharedArrayBuffer（多執行緒核心）。
 * ========================================================================== */

const CACHE = 'OwOAudioStudio-v1.0.0';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 刪除舊版本快取
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('OwOAudioStudio-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** 加上跨來源隔離標頭 */
function withIsolationHeaders(response) {
  if (!response || response.status === 0 || response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return; // 分段請求直接交給網路

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isEngine = url.pathname.includes('/Engine/');

    // 核心檔案體積大且不常變動：快取優先
    if (isEngine) {
      const cached = await cache.match(request);
      if (cached) return withIsolationHeaders(cached);
    }

    try {
      const response = await fetch(request);
      if (response.ok && response.status === 200 && request.cache !== 'no-store') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return withIsolationHeaders(response);
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return withIsolationHeaders(cached);
      throw error;
    }
  })());
});
