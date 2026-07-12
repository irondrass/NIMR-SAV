const CACHE_NAME = "nimr-sav-v23.3.0";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./rescue.html",
  "./styles.css?v=23.3.0",
  "./app.js?v=23.3.0",
  "./manifest.webmanifest",
  "./js/version.js?v=23.3.0",
  "./supabase-schema.sql",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./vendor/pdf.min.js?v=23.3.0",
  "./vendor/pdf.worker.min.js?v=23.3.0",
  "./js/utils.js?v=23.3.0",
  "./js/state.js?v=23.3.0",
  "./js/ui-cases.js?v=23.3.0",
  "./js/estimate-import.js?v=23.3.0",
  "./js/ui-planning.js?v=23.3.0",
  "./js/photos.js?v=23.3.0",
  "./js/storage.js?v=23.3.0",
  "./js/planning.js?v=23.3.0",
  "./js/exports.js?v=23.3.0",
  "./js/business-rules-v2187.js?v=23.3.0",
  "./js/sync-v2-core.js?v=23.3.0",
  "./js/sync-v2-shadow.js?v=23.3.0",
  "./js/supabase-config.js?v=23.3.0",
  "./js/supabase-client.js?v=23.3.0",
  "./js/supabase-sync.js?v=23.3.0",
];

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" }))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "APP_UPDATED", cacheName: CACHE_NAME }));
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response && response.ok && request.url.startsWith(self.location.origin)) {
      cache.put(request, response.clone()).catch(() => null);
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await caches.match("./index.html")) || caches.match("./offline.html");
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    fetch(request).then((response) => {
      if (response && response.ok && request.url.startsWith(self.location.origin)) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      }
    }).catch(() => null);
    return cached;
  }
  return networkFirst(request);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isCriticalAsset = event.request.mode === "navigate" || /\/(index\.html|offline\.html|app\.js|styles\.css|sw\.js|manifest\.webmanifest)$/.test(url.pathname) || /\/js\/.*\.js$/.test(url.pathname);
  event.respondWith(isCriticalAsset ? networkFirst(event.request) : cacheFirst(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CHECK_UPDATE") precache().then(() => event.source?.postMessage({ type: "CACHE_REFRESHED", cacheName: CACHE_NAME })).catch(() => null);
});
