const RECIPE_SCOPE = '/NIMR-SAV-V24-RECETTE/';
const CACHE_NAME = 'nimr-sav-v24-alpha20-recette';
const CACHE_PREFIX = 'nimr-sav-v24-';
const PRECACHE_URLS = [
  RECIPE_SCOPE,
  `${RECIPE_SCOPE}index.html`,
  `${RECIPE_SCOPE}manifest.webmanifest`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
      .catch(() => undefined)
  );
});

function isRecipeRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(RECIPE_SCOPE);
}

function isAssetRequest(url) {
  return isRecipeRequest(url) && url.pathname.includes(`${RECIPE_SCOPE}assets/`);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstIndex(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(`${RECIPE_SCOPE}index.html`, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(`${RECIPE_SCOPE}index.html`))
      || (await cache.match(RECIPE_SCOPE))
      || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isRecipeRequest(url)) return;

  if (isAssetRequest(url)) {
    event.respondWith(cacheFirst(request).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === 'navigate' || url.pathname === RECIPE_SCOPE || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirstIndex(request));
  }
});
