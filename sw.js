const CACHE_NAME = "nimr-carrosserie-v22.06-pause-reliquat";
const ASSETS = [
  "./",
  "./index.html",
  "./rescue.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./supabase-schema.sql",
  "./assets/icon.svg",
  "./data/vehicles.json",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./js/utils.js",
  "./js/state.js",
  "./js/ui-cases.js",
  "./js/estimate-import.js",
  "./js/ui-planning.js",
  "./js/photos.js",
  "./js/storage.js",
  "./js/planning.js",
  "./js/exports.js",
  "./js/business-rules-v2187.js",
  "./js/supabase-config.js",
  "./js/supabase-client.js",
  "./js/supabase-sync.js",
];

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" })).catch(() => null)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
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
    if (request.mode === "navigate") return caches.match("./index.html");
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
  const isCriticalAsset = event.request.mode === "navigate" || /\/(index\.html|app\.js|styles\.css|sw\.js|manifest\.webmanifest)$/.test(url.pathname) || /\/js\/.*\.js$/.test(url.pathname);
  event.respondWith(isCriticalAsset ? networkFirst(event.request) : cacheFirst(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CHECK_UPDATE") precache().then(() => event.source?.postMessage({ type: "CACHE_REFRESHED", cacheName: CACHE_NAME })).catch(() => null);
});
