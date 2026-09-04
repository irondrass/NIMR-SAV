// IDENTITY-001D2-E source refresh: prompt installed PWAs to fetch the updated authentication UI.
// IDENTITY-001D2-F source refresh: refresh the recovery OTP UI without changing the v23.3.20 cache contract.
// PERF-001 source refresh: render the cached PWA shell immediately while GitHub Pages revalidates in background.
// UX-010 source refresh: deliver the 2026 visual system and overlap hardening without changing the v23.3.20 cache contract.
// CACHE-001 source refresh: atomic worker-aligned release v23.3.21 with active cache isolation and immutable assets.
// SECUX-001 source refresh: atomic worker-aligned release v23.3.22 with XSS and keyboard accessibility hardening.
// WORKSHOP-001A source refresh: atomic worker-aligned release v23.3.23 with canonical task derivation model.
// WORKSHOP-001B source refresh: atomic worker-aligned release v23.3.24 with canonical task dependency DAG.
// RELEASE-001 source refresh: atomic worker-aligned release v23.3.25 with canonical portable release fingerprinting.
const CACHE_NAME = "nimr-sav-v23.3.25";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./rescue.html",
  "./styles.css?v=23.3.25",
  "./app.js?v=23.3.25",
  "./manifest.webmanifest",
  "./js/version.js?v=23.3.25",
  "./supabase-schema.sql",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./vendor/pdf.min.js?v=23.3.25",
  "./vendor/pdf.worker.min.js?v=23.3.25",
  "./js/utils.js?v=23.3.25",
  "./js/state.js?v=23.3.25",
  "./js/ui-cases.js?v=23.3.25",
  "./js/estimate-import.js?v=23.3.25",
  "./js/ui-planning.js?v=23.3.25",
  "./js/photos.js?v=23.3.25",
  "./js/storage.js?v=23.3.25",
  "./js/work-hours-sync.js?v=23.3.25",
  "./js/planning.js?v=23.3.25",
  "./js/exports.js?v=23.3.25",
  "./js/business-rules-v2187.js?v=23.3.25",
  "./js/supabase-config.js?v=23.3.25",
  "./js/supabase-client.js?v=23.3.25",
  "./js/supabase-sync.js?v=23.3.25",
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
    await Promise.all(
      keys
        .filter((key) => key.startsWith("nimr-sav-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "APP_UPDATED", cacheName: CACHE_NAME }));
  })());
});

function isReleaseAsset(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("v") === "23.3.25";
  } catch {
    return false;
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response && response.ok && request.url.startsWith(self.location.origin)) {
      cache.put(request, response.clone()).catch(() => null);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await cache.match("./index.html")) || cache.match("./offline.html");
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    // IMMUTABLE RELEASE ASSET: Never revalidate versioned code against mutable origin
    return cached;
  }
  if (isReleaseAsset(request.url)) {
    // FAIL CLOSED on missing active-release executable asset:
    // Never fetch mutable origin or pollute active cache with foreign bytes
    return Response.error();
  }
  return networkFirst(request);
}

const APP_BASE_PATH = new URL("./", self.location.href).pathname;

async function appNavigationFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request)
    || await cache.match("./index.html")
    || await cache.match("./");
  if (cached) {
    // Active worker serves its own immutable release shell without background revalidation
    return cached;
  }
  const offline = await cache.match("./offline.html");
  if (offline) return offline;
  return Response.error();
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
  // CHECK_UPDATE is a legacy no-op: actual update discovery uses registration.update() from app.js.
  // CRITICAL: Do NOT call precache(), cache.put(), or fetch release assets here.
  // Do NOT emit CACHE_REFRESHED — no cache refresh occurs.
});
