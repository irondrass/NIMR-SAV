// IDENTITY-001D2-E source refresh: prompt installed PWAs to fetch the updated authentication UI.
// IDENTITY-001D2-F source refresh: refresh the recovery OTP UI without changing the v23.3.20 cache contract.
// PERF-001 source refresh: render the cached PWA shell immediately while GitHub Pages revalidates in background.
const CACHE_NAME = "nimr-sav-v23.3.20";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./rescue.html",
  "./styles.css?v=23.3.20",
  "./app.js?v=23.3.20",
  "./manifest.webmanifest",
  "./js/version.js?v=23.3.20",
  "./supabase-schema.sql",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./vendor/pdf.min.js?v=23.3.20",
  "./vendor/pdf.worker.min.js?v=23.3.20",
  "./js/utils.js?v=23.3.20",
  "./js/state.js?v=23.3.20",
  "./js/ui-cases.js?v=23.3.20",
  "./js/estimate-import.js?v=23.3.20",
  "./js/ui-planning.js?v=23.3.20",
  "./js/photos.js?v=23.3.20",
  "./js/storage.js?v=23.3.20",
  "./js/work-hours-sync.js?v=23.3.20",
  "./js/planning.js?v=23.3.20",
  "./js/exports.js?v=23.3.20",
  "./js/business-rules-v2187.js?v=23.3.20",
  "./js/supabase-config.js?v=23.3.20",
  "./js/supabase-client.js?v=23.3.20",
  "./js/supabase-sync.js?v=23.3.20",
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

async function refreshCachedRequest(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
  } catch {
    // Best effort only: cached UI must remain immediately usable.
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    refreshCachedRequest(request).catch(() => null);
    return cached;
  }
  return networkFirst(request);
}

const APP_BASE_PATH = new URL("./", self.location.href).pathname;

async function appNavigationFirst(request) {
  const cached = await caches.match(request)
    || await caches.match("./index.html")
    || await caches.match("./");
  if (cached) {
    refreshCachedRequest(request).catch(() => null);
    return cached;
  }
  return networkFirst(request);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isAppNavigation = event.request.mode === "navigate"
    && (url.pathname === APP_BASE_PATH || url.pathname === `${APP_BASE_PATH}index.html`);
  if (isAppNavigation) {
    event.respondWith(appNavigationFirst(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CHECK_UPDATE") precache().then(() => event.source?.postMessage({ type: "CACHE_REFRESHED", cacheName: CACHE_NAME })).catch(() => null);
});
