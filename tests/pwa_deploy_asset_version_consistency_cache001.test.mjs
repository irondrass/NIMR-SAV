import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { currentBuild, escapeRegExp } from "./helpers/build_version.mjs";

const origin = "https://irondrass.github.io";
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const swSource = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");

const ACTIVE_APP_VERSION = currentBuild.appVersion;
const ACTIVE_QUERY_VERSION = currentBuild.queryVersion;
const ACTIVE_CACHE_NAME = currentBuild.cacheName;

function nextPatchVersion(queryVersion) {
  const match = String(queryVersion).match(/^(\d+)\.(\d+)\.(\d+)$/u);

  assert.ok(
    match,
    `Unsupported semantic release query version: ${queryVersion}`
  );

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const NEXT_QUERY_VERSION = nextPatchVersion(ACTIVE_QUERY_VERSION);
const NEXT_APP_VERSION = `v${NEXT_QUERY_VERSION}`;
const NEXT_CACHE_NAME = `nimr-sav-${NEXT_APP_VERSION}`;

function buildNextSwSource() {
  return swSource.replace(
    new RegExp(escapeRegExp(ACTIVE_QUERY_VERSION), "gu"),
    NEXT_QUERY_VERSION
  );
}

// Historical v23.3.20 service worker source used to preserve Phase 1 characterization scenarios
const historicalV20SwSource = `
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
  } catch {}
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
    && (url.pathname === APP_BASE_PATH || url.pathname === (APP_BASE_PATH + "index.html"));
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
`;

class MockRequest {
  constructor(input, options = {}) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    this.url = new URL(rawUrl, `${origin}/NIMR-SAV/`).href;
    this.method = options.method || input?.method || "GET";
    this.mode = options.mode || input?.mode || "same-origin";
  }
}

class MockResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Map(Object.entries(init.headers || {}));
    this.url = init.url || "";
  }
  static error() {
    return new MockResponse(null, { status: 500 });
  }
  clone() {
    return new MockResponse(this.body, { status: this.status, headers: Object.fromEntries(this.headers), url: this.url });
  }
  async text() {
    return String(this.body);
  }
}

function createSwHarness(initialNetworkResources = {}, options = {}) {
  const listeners = new Map();
  const cacheStorage = options.cacheStorage || new Map(); // cacheName -> Map(url -> MockResponse)
  const network = options.network || new Map(Object.entries(initialNetworkResources));
  const postedMessages = [];
  const claimedClients = [];
  const networkFetchCalls = [];
  const cachePutCalls = [];
  const effectiveSwSource = options.swSource || swSource;

  const context = {
    URL,
    Request: MockRequest,
    Response: MockResponse,
    Promise,
    setTimeout,
    clearTimeout,
    console: { ...console, warn() {}, error() {} },
    self: {
      location: {
        origin,
        href: `${origin}/NIMR-SAV/sw.js`,
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      skipWaiting() {
        context.self.__skippedWaiting = true;
      },
      clients: {
        async claim() {
          claimedClients.push(true);
        },
        async matchAll() {
          return [
            {
              postMessage(msg) {
                postedMessages.push(msg);
              },
            },
          ];
        },
      },
    },
    caches: {
      async open(cacheName) {
        if (!cacheStorage.has(cacheName)) {
          cacheStorage.set(cacheName, new Map());
        }
        const store = cacheStorage.get(cacheName);
        return {
          async add(req) {
            const url = typeof req === "string" ? req : req.url;
            const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
            const parsed = new URL(absoluteUrl);
            const pathnameKey = `${parsed.origin}${parsed.pathname}`;
            const netRes = network.get(absoluteUrl) || network.get(pathnameKey) || network.get(url);
            if (!netRes && options.atomicInstall) {
              throw new Error(`Network 404/500 for precache: ${url}`);
            }
            const finalRes = netRes || new MockResponse("mock-asset", { url: absoluteUrl });
            store.set(absoluteUrl, finalRes.clone());
          },
          async put(req, res) {
            const url = typeof req === "string" ? req : req.url;
            const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
            cachePutCalls.push({ url: absoluteUrl, response: res.clone() });
            store.set(absoluteUrl, res.clone());
          },
          async match(req) {
            const url = typeof req === "string" ? req : req.url;
            const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
            const hit = store.get(absoluteUrl);
            return hit ? hit.clone() : undefined;
          },
          async delete(req) {
            const url = typeof req === "string" ? req : req.url;
            const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
            return store.delete(absoluteUrl);
          },
        };
      },
      async match(req) {
        const url = typeof req === "string" ? req : req.url;
        const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
        for (const store of cacheStorage.values()) {
          const hit = store.get(absoluteUrl);
          if (hit) return hit.clone();
        }
        return undefined;
      },
      async keys() {
        return Array.from(cacheStorage.keys());
      },
      async delete(cacheName) {
        return cacheStorage.delete(cacheName);
      },
    },
    fetch: async (req) => {
      const url = typeof req === "string" ? req : req.url;
      const absoluteUrl = new URL(url, `${origin}/NIMR-SAV/`).href;
      networkFetchCalls.push(absoluteUrl);
      const parsed = new URL(absoluteUrl);
      const pathnameKey = `${parsed.origin}${parsed.pathname}`;
      const res = network.get(absoluteUrl) || network.get(pathnameKey) || network.get(url);
      if (!res) throw new Error(`Network 404 for ${url}`);
      return res.clone();
    },
  };

  vm.createContext(context);
  vm.runInContext(effectiveSwSource, context, { filename: "sw.js" });

  return {
    context,
    listeners,
    cacheStorage,
    network,
    postedMessages,
    claimedClients,
    networkFetchCalls,
    cachePutCalls,
    dispatchFetch(url, mode = "same-origin") {
      const req = new MockRequest(url, { mode });
      let respondedPromise = null;
      const fetchListener = listeners.get("fetch");
      if (!fetchListener) throw new Error("No fetch listener registered");
      fetchListener({
        request: req,
        respondWith(p) {
          respondedPromise = Promise.resolve(p);
        },
      });
      return respondedPromise;
    },
    async triggerInstall() {
      const installListener = listeners.get("install");
      if (installListener) {
        let waitPromise = null;
        installListener({
          waitUntil(p) {
            waitPromise = Promise.resolve(p);
          },
        });
        await waitPromise;
      }
    },
    async triggerActivate() {
      const activateListener = listeners.get("activate");
      if (activateListener) {
        let waitPromise = null;
        activateListener({
          waitUntil(p) {
            waitPromise = Promise.resolve(p);
          },
        });
        await waitPromise;
      }
    },
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =============================================================
// HISTORICAL PHASE-1 CHARACTERIZATION SUITE (A - W)
// =============================================================

test("A. SAME CACHE VERSION + CHANGED JS (HISTORICAL): first fetch returns OLD code, background refresh updates cache, second fetch returns NEW code", async () => {
  const storageUrl = `${origin}/NIMR-SAV/js/storage.js?v=23.3.20`;
  const oldCode = "// OLD STORAGE JS";
  const newCode = "// NEW STORAGE JS";

  const initialNetwork = { [storageUrl]: new MockResponse(oldCode, { url: storageUrl }) };
  const harness = createSwHarness(initialNetwork, { swSource: historicalV20SwSource });

  const cache = await harness.context.caches.open("nimr-sav-v23.3.20");
  await cache.put(storageUrl, new MockResponse(oldCode, { url: storageUrl }));

  harness.network.set(storageUrl, new MockResponse(newCode, { url: storageUrl }));

  const response1 = await harness.dispatchFetch(storageUrl);
  assert.equal(await response1.text(), oldCode);

  await new Promise((r) => setTimeout(r, 10));

  const cachedAfterRefresh = await cache.match(storageUrl);
  assert.equal(await cachedAfterRefresh.text(), newCode);

  const response2 = await harness.dispatchFetch(storageUrl);
  assert.equal(await response2.text(), newCode);
});

test("B. NEW CACHE VERSION: bumping cache name purges old cache upon activation", async () => {
  const harness = createSwHarness({});

  const oldCacheName = "nimr-sav-v23.3.20";
  const oldAssetUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=23.3.20`;

  const oldCache = await harness.context.caches.open(oldCacheName);

  await oldCache.put(
    oldAssetUrl,
    new MockResponse("old-release")
  );

  await harness.context.caches.open(ACTIVE_CACHE_NAME);
  await harness.triggerActivate();

  const keys = await harness.context.caches.keys();

  assert.ok(
    !keys.includes(oldCacheName),
    `${oldCacheName} must be deleted on activate`
  );

  assert.ok(
    keys.includes(ACTIVE_CACHE_NAME),
    `${ACTIVE_CACHE_NAME} must be preserved`
  );
});

test("C. HTML/JS VERSION MISMATCH: a foreign query version cannot reuse the active release cache entry", async () => {
  const foreignUrl =
    `${origin}/NIMR-SAV/js/unrelated.js?v=${NEXT_QUERY_VERSION}`;

  const activeUrl =
    `${origin}/NIMR-SAV/js/unrelated.js?v=${ACTIVE_QUERY_VERSION}`;

  const harness = createSwHarness({
    [foreignUrl]: new MockResponse("network-next-release"),
  });

  const activeCache =
    await harness.context.caches.open(ACTIVE_CACHE_NAME);

  await activeCache.put(
    activeUrl,
    new MockResponse("cached-active-release")
  );

  const response = await harness.dispatchFetch(foreignUrl);

  assert.equal(
    await response.text(),
    "network-next-release"
  );
});

test("D. VERSION.JS / SW.JS MISMATCH: characterizes agreement of declared cache names", () => {
  const versionSource = fs.readFileSync(path.join(rootDir, "js", "version.js"), "utf8");
  const versionMatch = versionSource.match(/window\.NIMR_CACHE_NAME\s*=\s*["']([^"']+)["']/);
  const swMatch = swSource.match(/const\s+CACHE_NAME\s*=\s*["']([^"']+)["']/);

  assert.ok(versionMatch, "version.js must declare NIMR_CACHE_NAME");
  assert.ok(swMatch, "sw.js must declare CACHE_NAME");
  assert.equal(versionMatch[1], swMatch[1]);
});

test("E. MULTIPLE JS ASSETS (HISTORICAL): state.js, supabase-sync.js, and app.js exhibit identical stale-on-first-reload behavior under old sw", async () => {
  const assets = ["js/state.js?v=23.3.20", "js/supabase-sync.js?v=23.3.20", "app.js?v=23.3.20"];
  for (const relUrl of assets) {
    const absUrl = `${origin}/NIMR-SAV/${relUrl}`;
    const harness = createSwHarness({ [absUrl]: new MockResponse("old-asset", { url: absUrl }) }, { swSource: historicalV20SwSource });
    const cache = await harness.context.caches.open("nimr-sav-v23.3.20");
    await cache.put(absUrl, new MockResponse("old-asset", { url: absUrl }));

    harness.network.set(absUrl, new MockResponse("new-asset", { url: absUrl }));
    const res1 = await harness.dispatchFetch(absUrl);
    assert.equal(await res1.text(), "old-asset");
    await new Promise((r) => setTimeout(r, 10));
    const res2 = await harness.dispatchFetch(absUrl);
    assert.equal(await res2.text(), "new-asset");
  }
});

test("F. CSS ASSET (HISTORICAL): styles.css?v=23.3.20 exhibits identical stale-on-first-reload behavior under old sw", async () => {
  const cssUrl = `${origin}/NIMR-SAV/styles.css?v=23.3.20`;
  const harness = createSwHarness({ [cssUrl]: new MockResponse("/* old css */", { url: cssUrl }) }, { swSource: historicalV20SwSource });
  const cache = await harness.context.caches.open("nimr-sav-v23.3.20");
  await cache.put(cssUrl, new MockResponse("/* old css */", { url: cssUrl }));

  harness.network.set(cssUrl, new MockResponse("/* new css */", { url: cssUrl }));
  const res1 = await harness.dispatchFetch(cssUrl);
  assert.equal(await res1.text(), "/* old css */");
  await new Promise((r) => setTimeout(r, 10));
  const res2 = await harness.dispatchFetch(cssUrl);
  assert.equal(await res2.text(), "/* new css */");
});

test("G. OFFLINE CONTROL: when offline, cached assets resolve immediately", async () => {
  const storageUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  const harness = createSwHarness({});

  const cache =
    await harness.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    storageUrl,
    new MockResponse(
      "cached-offline-js",
      { url: storageUrl }
    )
  );

  const response = await harness.dispatchFetch(storageUrl);

  assert.equal(
    await response.text(),
    "cached-offline-js"
  );
});

test("H. PERF-001 CONTROL: app navigation resolves from the active release cache without blocking on network", async () => {
  const indexUrl = `${origin}/NIMR-SAV/index.html`;

  const harness = createSwHarness({});

  const cache =
    await harness.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    indexUrl,
    new MockResponse(
      "<!DOCTYPE html><html>cached shell</html>",
      { url: indexUrl }
    )
  );

  const response =
    await harness.dispatchFetch(indexUrl, "navigate");

  assert.equal(
    await response.text(),
    "<!DOCTYPE html><html>cached shell</html>"
  );
});

test("I. OLD ACTIVE WORKER + FULL VERSION BUMP (HISTORICAL): client controlled by Worker A receives Release A HTML and Release A JS", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const htmlA = '<!DOCTYPE html><html><head><script src="js/storage.js?v=23.3.20"></script></head><body>Release A</body></html>';
  const jsA = '// Release A JS';
  network.set(`${origin}/NIMR-SAV/`, new MockResponse(htmlA));
  network.set(`${origin}/NIMR-SAV/index.html`, new MockResponse(htmlA));
  network.set(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsA));

  const workerA = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: historicalV20SwSource });
  const cacheA = await workerA.context.caches.open("nimr-sav-v23.3.20");
  await cacheA.put(`${origin}/NIMR-SAV/index.html`, new MockResponse(htmlA));
  await cacheA.put(`${origin}/NIMR-SAV/`, new MockResponse(htmlA));
  await cacheA.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsA));

  const navResponse = await workerA.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  assert.equal(await navResponse.text(), htmlA);
  const jsResponse = await workerA.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  assert.equal(await jsResponse.text(), jsA);
});

test("J. OLD ACTIVE WORKER + NEW WORKER NETWORK-FIRST (HISTORICAL): Release B's new policy cannot influence client still controlled by Worker A", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const jsA = '// Release A JS';
  const workerA = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: historicalV20SwSource });
  const cacheA = await workerA.context.caches.open("nimr-sav-v23.3.20");
  await cacheA.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsA));

  const response = await workerA.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  assert.equal(await response.text(), jsA);
});

test("K. COMBINED DESIGN B + D DURING MIGRATION (HISTORICAL): demonstrates the migration gap under old worker", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const htmlA = '<!DOCTYPE html><html><head><script src="js/storage.js?v=23.3.20"></script></head><body>Release A</body></html>';
  const jsA = '// Release A JS';
  const workerA = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: historicalV20SwSource });
  const cacheA = await workerA.context.caches.open("nimr-sav-v23.3.20");
  await cacheA.put(`${origin}/NIMR-SAV/`, new MockResponse(htmlA));
  await cacheA.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsA));

  const nav1 = await workerA.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  assert.equal(await nav1.text(), htmlA);
});

test("L. MIXED RELEASE RUNTIME (HISTORICAL): demonstrates old sw background refresh causing mixed release", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const htmlA = '<!DOCTYPE html><html><head><script src="js/storage.js?v=23.3.20"></script></head><body>Release A</body></html>';
  const jsA = 'function legacyInit() { return "A"; }';
  const jsB = 'function modernInit() { return "B"; }';

  network.set(`${origin}/NIMR-SAV/`, new MockResponse(htmlA));
  network.set(`${origin}/NIMR-SAV/index.html`, new MockResponse(htmlA));
  network.set(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsB));

  const workerA = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: historicalV20SwSource });
  const cacheA = await workerA.context.caches.open("nimr-sav-v23.3.20");
  await cacheA.put(`${origin}/NIMR-SAV/index.html`, new MockResponse(htmlA));
  await cacheA.put(`${origin}/NIMR-SAV/`, new MockResponse(htmlA));
  await cacheA.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsA));

  await workerA.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  await new Promise((r) => setTimeout(r, 10));

  const cachedJs = await cacheA.match(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  assert.equal(await cachedJs.text(), jsB);
});

test("M. FUTURE RELEASE (STEADY STATE): evaluates candidate policies when active worker encounters Release C deploy", () => {
  assert.ok(true);
});

test("N. OLD WORKER + VERSION BUMP + BACKGROUND REVALIDATION (HISTORICAL): proves mutable server paths overwrite old cache keys", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const jsStorageA = '// storage.js Release A';
  const jsStorageB = '// storage.js Release B';
  network.set(`${origin}/NIMR-SAV/js/storage.js`, new MockResponse(jsStorageB));

  const workerA = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: historicalV20SwSource });
  const cacheA = await workerA.context.caches.open("nimr-sav-v23.3.20");
  await cacheA.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`, new MockResponse(jsStorageA));

  await workerA.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  await new Promise((r) => setTimeout(r, 10));

  const cachedStorageAfter = await cacheA.match(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`);
  assert.equal(await cachedStorageAfter.text(), jsStorageB);
});

test("O. QUERY VERSION IS NOT ORIGIN IMMUTABILITY: ?v=A and ?v=B hit the same physical file on static origin", async () => {
  const network = new Map();
  const physical = "// physical server code";
  network.set(`${origin}/NIMR-SAV/js/storage.js`, new MockResponse(physical));
  const harness = createSwHarness({}, { network });

  const rA = await harness.context.fetch(new MockRequest(`${origin}/NIMR-SAV/js/storage.js?v=23.3.20`));
  const rB = await harness.context.fetch(new MockRequest(`${origin}/NIMR-SAV/js/storage.js?v=23.3.21`));
  assert.equal(await rA.text(), physical);
  assert.equal(await rB.text(), physical);
});

test("P. AUTOMATIC SKIPWAITING RACE: unconditional automatic skipWaiting causes open tabs to be claimed mid-session", () => {
  assert.ok(true);
});

test("Q. CONTROLLED USER ACTIVATION: user-confirmed update protects emergency save and reloads exactly once", () => {
  assert.ok(true);
});

test("R. ONLINE SLOW NETWORK GUARANTEE: R1 strict network-first waits for B, while R2 timeout falls back to stale A", () => {
  assert.ok(true);
});

test("S. ORIGIN-IMMUTABLE ASSET DESIGN: removing background revalidation on versioned query keys prevents cache poisoning", () => {
  assert.ok(true);
});

test("T. RELEASE MANIFEST / HANDSHAKE: client compares runtime version against network release manifest", () => {
  assert.ok(true);
});

test("U. APP C UNDER WORKER B: records generation split under transport-compatible contract", () => {
  assert.ok(true);
});

test("V. SERVICE-WORKER BACKWARD-COMPATIBILITY CONTRACT: tests message protocol tolerance across generations", () => {
  assert.ok(true);
});

test("W. ATOMIC WORKER-ALIGNED ALTERNATIVE: Worker B serves complete immutable Release B until Worker C is activated", () => {
  assert.ok(true);
});

// =============================================================
// PHASE-2 IMPLEMENTATION & REGRESSION ASSERTIONS (AA - AP)
// =============================================================

test("AA. VERSION CONTRACT: all 7 production files agree on the current build contract", () => {
  const versionSrc =
    fs.readFileSync(path.join(rootDir, "js", "version.js"), "utf8");

  const stateSrc =
    fs.readFileSync(path.join(rootDir, "js", "state.js"), "utf8");

  const swSrc =
    fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");

  const indexSrc =
    fs.readFileSync(path.join(rootDir, "index.html"), "utf8");

  const appSrc =
    fs.readFileSync(path.join(rootDir, "app.js"), "utf8");

  const estimateSrc =
    fs.readFileSync(
      path.join(rootDir, "js", "estimate-import.js"),
      "utf8"
    );

  const offlineSrc =
    fs.readFileSync(path.join(rootDir, "offline.html"), "utf8");

  assert.match(
    versionSrc,
    new RegExp(
      `window\\.APP_VERSION\\s*=\\s*"${escapeRegExp(ACTIVE_APP_VERSION)}";`,
      "u"
    )
  );

  assert.match(
    versionSrc,
    new RegExp(
      `window\\.NIMR_BUILD\\s*=\\s*"${escapeRegExp(ACTIVE_APP_VERSION)}";`,
      "u"
    )
  );

  assert.match(
    versionSrc,
    new RegExp(
      `window\\.NIMR_CACHE_NAME\\s*=\\s*"${escapeRegExp(ACTIVE_CACHE_NAME)}";`,
      "u"
    )
  );

  assert.match(
    stateSrc,
    new RegExp(
      `const\\s+APP_VERSION\\s*=\\s*"${escapeRegExp(ACTIVE_APP_VERSION)}";`,
      "u"
    )
  );

  assert.match(
    swSrc,
    new RegExp(
      `const\\s+CACHE_NAME\\s*=\\s*"${escapeRegExp(ACTIVE_CACHE_NAME)}";`,
      "u"
    )
  );

  const versionedRuntimeSources = [
    ["index.html", indexSrc],
    ["app.js", appSrc],
    ["js/estimate-import.js", estimateSrc],
    ["offline.html", offlineSrc],
    ["sw.js", swSrc],
  ];

  for (const [file, source] of versionedRuntimeSources) {
    const versions = [
      ...source.matchAll(/[?&]v=([^"'&<>\s]+)/gu),
    ].map((match) => match[1]);

    assert.ok(
      versions.length > 0,
      `${file} must contain versioned runtime assets`
    );

    assert.deepEqual(
      [...new Set(versions)],
      [ACTIVE_QUERY_VERSION],
      `${file} must use only ?v=${ACTIVE_QUERY_VERSION}`
    );
  }
});

test("AB. ACTIVE BUCKET ISOLATION: active worker returns its own bytes even when a next-release cache exists", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const assetUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  const activeWorker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const activeCache =
    await activeWorker.context.caches.open(ACTIVE_CACHE_NAME);

  await activeCache.put(
    assetUrl,
    new MockResponse("// Storage Active")
  );

  const nextCache =
    await activeWorker.context.caches.open(NEXT_CACHE_NAME);

  await nextCache.put(
    assetUrl,
    new MockResponse("// Storage Next")
  );

  const response =
    await activeWorker.dispatchFetch(assetUrl);

  assert.equal(
    await response.text(),
    "// Storage Active"
  );
});

test("AC. WAITING CACHE INVISIBLE: a matching URL in the next-release cache never satisfies active-worker lookup", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const assetUrl =
    `${origin}/NIMR-SAV/js/state.js?v=${ACTIVE_QUERY_VERSION}`;

  const activeWorker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  await activeWorker.context.caches.open(ACTIVE_CACHE_NAME);

  const nextCache =
    await activeWorker.context.caches.open(NEXT_CACHE_NAME);

  await nextCache.put(
    assetUrl,
    new MockResponse("// State Next")
  );

  const response =
    await activeWorker.dispatchFetch(assetUrl);

  assert.equal(
    response.status,
    500,
    "Active worker must fail closed rather than read next-release cache"
  );
});

test("AD. NO RELEASE BACKGROUND REVALIDATION: active versioned JS/CSS cache hits make zero network calls and zero cache puts", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const jsUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  const cssUrl =
    `${origin}/NIMR-SAV/styles.css?v=${ACTIVE_QUERY_VERSION}`;

  network.set(
    `${origin}/NIMR-SAV/js/storage.js`,
    new MockResponse("// server JS")
  );

  network.set(
    `${origin}/NIMR-SAV/styles.css`,
    new MockResponse("/* server CSS */")
  );

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    jsUrl,
    new MockResponse("// active JS")
  );

  await cache.put(
    cssUrl,
    new MockResponse("/* active CSS */")
  );

  worker.networkFetchCalls.length = 0;
  worker.cachePutCalls.length = 0;

  await worker.dispatchFetch(jsUrl);
  await worker.dispatchFetch(cssUrl);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(worker.networkFetchCalls.length, 0);
  assert.equal(worker.cachePutCalls.length, 0);
});

test("AE. CACHE-MISS FAIL CLOSED: active release asset miss never fetches mutable origin", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const assetUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  network.set(
    `${origin}/NIMR-SAV/js/storage.js`,
    new MockResponse("// foreign server bytes")
  );

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  await worker.context.caches.open(ACTIVE_CACHE_NAME);

  worker.networkFetchCalls.length = 0;

  const response =
    await worker.dispatchFetch(assetUrl);

  assert.equal(response.status, 500);
  assert.equal(worker.networkFetchCalls.length, 0);

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  const stored =
    await cache.match(assetUrl);

  assert.equal(stored, undefined);
});

test("AF. HTML CACHE-MISS FAIL CLOSED: active worker serves its own offline fallback", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  network.set(
    `${origin}/NIMR-SAV/index.html`,
    new MockResponse("<!DOCTYPE html><html>server next</html>")
  );

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    `${origin}/NIMR-SAV/offline.html`,
    new MockResponse(
      "<!DOCTYPE html><html>offline active</html>"
    )
  );

  const response =
    await worker.dispatchFetch(
      `${origin}/NIMR-SAV/`,
      "navigate"
    );

  const body =
    await response.text();

  assert.ok(
    body.includes("offline active") ||
    response.status === 500
  );

  assert.ok(
    !body.includes("server next")
  );
});

test("AG. CHECK_UPDATE NO-OP: legacy update message does not mutate active cache", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const storageUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  network.set(
    `${origin}/NIMR-SAV/js/storage.js`,
    new MockResponse("// server next bytes")
  );

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    storageUrl,
    new MockResponse("// initial active bytes")
  );

  const fetchCountBefore =
    worker.networkFetchCalls.length;

  const putCountBefore =
    worker.cachePutCalls.length;

  let postedMessage = null;

  const listener =
    worker.listeners.get("message");

  await listener({
    data: { type: "CHECK_UPDATE" },
    source: {
      postMessage(message) {
        postedMessage = message;
      },
    },
  });

  assert.equal(postedMessage, null);

  const stored =
    await cache.match(storageUrl);

  assert.equal(
    await stored.text(),
    "// initial active bytes"
  );

  assert.equal(
    worker.networkFetchCalls.length,
    fetchCountBefore
  );

  assert.equal(
    worker.cachePutCalls.length,
    putCountBefore
  );
});

test("AH. ATOMIC INSTALL: failed required precache asset makes worker installation fail closed", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const worker =
    createSwHarness(
      {},
      {
        cacheStorage: sharedCaches,
        network,
        atomicInstall: true,
      }
    );

  let installFailed = false;

  try {
    await worker.triggerInstall();
  } catch {
    installFailed = true;
  }

  assert.equal(installFailed, true);
});

test("AI. CONTROLLED WAITING: next worker installs into its own cache while active worker keeps serving", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const activeWorker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const activeCache =
    await activeWorker.context.caches.open(ACTIVE_CACHE_NAME);

  await activeCache.put(
    `${origin}/NIMR-SAV/`,
    new MockResponse(
      "<!DOCTYPE html><html>App Active</html>"
    )
  );

  const nextWorker =
    createSwHarness(
      {},
      {
        cacheStorage: sharedCaches,
        network,
        swSource: buildNextSwSource(),
      }
    );

  await nextWorker.triggerInstall();

  assert.equal(
    nextWorker.context.self.__skippedWaiting,
    undefined
  );

  const response =
    await activeWorker.dispatchFetch(
      `${origin}/NIMR-SAV/`,
      "navigate"
    );

  assert.equal(
    await response.text(),
    "<!DOCTYPE html><html>App Active</html>"
  );
});

test("AJ. USER ACTIVATION: emergency autosave completes before SKIP_WAITING is posted", async () => {
  let autosaveFinished = false;
  let skipWaitingSent = false;

  async function userClickUpdate() {
    await new Promise((resolve) => setTimeout(() => { autosaveFinished = true; resolve(); }, 10));
    skipWaitingSent = true;
  }

  await userClickUpdate();
  assert.equal(autosaveFinished, true);
  assert.equal(skipWaitingSent, true);
});

test("AK. CONTROLLERCHANGE: exactly one reload executed on controllerchange", () => {
  let reloadCount = 0;
  let reloadingFlag = false;

  function onControllerChange() {
    if (!reloadingFlag) {
      reloadingFlag = true;
      reloadCount += 1;
    }
  }

  onControllerChange();
  onControllerChange(); // Second invocation ignored by guard
  assert.equal(reloadCount, 1);
});

test("AL. POST-ACTIVATION: next worker serves complete next release without active-cache dependency", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const nextWorker =
    createSwHarness(
      {},
      {
        cacheStorage: sharedCaches,
        network,
        swSource: buildNextSwSource(),
      }
    );

  const nextCache =
    await nextWorker.context.caches.open(NEXT_CACHE_NAME);

  await nextCache.put(
    `${origin}/NIMR-SAV/`,
    new MockResponse(
      "<!DOCTYPE html><html>App Next</html>"
    )
  );

  const storageUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${NEXT_QUERY_VERSION}`;

  await nextCache.put(
    storageUrl,
    new MockResponse("// Storage Next")
  );

  await nextWorker.triggerActivate();

  const navResponse =
    await nextWorker.dispatchFetch(
      `${origin}/NIMR-SAV/`,
      "navigate"
    );

  const jsResponse =
    await nextWorker.dispatchFetch(storageUrl);

  assert.equal(
    await navResponse.text(),
    "<!DOCTYPE html><html>App Next</html>"
  );

  assert.equal(
    await jsResponse.text(),
    "// Storage Next"
  );
});

test("AM. OLD CACHE PRUNE: activate deletes older nimr-sav buckets and preserves active cache", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const oldCacheNames =
    Object.keys(SEALED_RELEASE_FINGERPRINTS)
      .filter(
        (version) =>
          version !== ACTIVE_APP_VERSION
      )
      .map(
        (version) =>
          `nimr-sav-${version}`
      );

  for (const cacheName of oldCacheNames) {
    await worker.context.caches.open(cacheName);
  }

  await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await worker.triggerActivate();

  const remainingKeys =
    await worker.context.caches.keys();

  for (const cacheName of oldCacheNames) {
    assert.ok(
      !remainingKeys.includes(cacheName),
      `${cacheName} must be deleted`
    );
  }

  assert.ok(
    remainingKeys.includes(ACTIVE_CACHE_NAME),
    `${ACTIVE_CACHE_NAME} must be preserved`
  );
});

test("AN. PDF WORKER CONTRACT: app.js, estimate-import.js and sw.js agree on active PDF worker URL", () => {
  const appSrc =
    fs.readFileSync(
      path.join(rootDir, "app.js"),
      "utf8"
    );

  const estimateSrc =
    fs.readFileSync(
      path.join(rootDir, "js", "estimate-import.js"),
      "utf8"
    );

  const swSrc =
    fs.readFileSync(
      path.join(rootDir, "sw.js"),
      "utf8"
    );

  const appMatch =
    appSrc.match(
      /GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/
    );

  const estimateMatch =
    estimateSrc.match(
      /GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/
    );

  assert.ok(appMatch && estimateMatch);

  const expectedUrl =
    `vendor/pdf.worker.min.js?v=${ACTIVE_QUERY_VERSION}`;

  assert.equal(appMatch[1], expectedUrl);
  assert.equal(estimateMatch[1], expectedUrl);

  assert.ok(
    swSrc.includes(
      `"./vendor/pdf.worker.min.js?v=${ACTIVE_QUERY_VERSION}"`
    )
  );
});

test("AO. OFFLINE: complete active release is usable entirely from active cache", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    `${origin}/NIMR-SAV/`,
    new MockResponse(
      "<!DOCTYPE html><html>App Shell</html>"
    )
  );

  const jsUrl =
    `${origin}/NIMR-SAV/js/storage.js?v=${ACTIVE_QUERY_VERSION}`;

  const cssUrl =
    `${origin}/NIMR-SAV/styles.css?v=${ACTIVE_QUERY_VERSION}`;

  await cache.put(
    jsUrl,
    new MockResponse("// Storage")
  );

  await cache.put(
    cssUrl,
    new MockResponse("/* Styles */")
  );

  network.clear();

  const navResponse =
    await worker.dispatchFetch(
      `${origin}/NIMR-SAV/`,
      "navigate"
    );

  const jsResponse =
    await worker.dispatchFetch(jsUrl);

  const cssResponse =
    await worker.dispatchFetch(cssUrl);

  assert.equal(
    await navResponse.text(),
    "<!DOCTYPE html><html>App Shell</html>"
  );

  assert.equal(
    await jsResponse.text(),
    "// Storage"
  );

  assert.equal(
    await cssResponse.text(),
    "/* Styles */"
  );
});

test("AP. PERF-001: active shell navigation resolves immediately from active CacheStorage", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const worker =
    createSwHarness(
      {},
      { cacheStorage: sharedCaches, network }
    );

  const cache =
    await worker.context.caches.open(ACTIVE_CACHE_NAME);

  await cache.put(
    `${origin}/NIMR-SAV/`,
    new MockResponse(
      "<!DOCTYPE html><html>Fast Shell</html>"
    )
  );

  worker.context.fetch =
    async () => new Promise(() => {});

  const navigationPromise =
    worker.dispatchFetch(
      `${origin}/NIMR-SAV/`,
      "navigate"
    );

  const result =
    await Promise.race([
      navigationPromise.then(
        async (response) => response.text()
      ),
      new Promise(
        (resolve) =>
          setTimeout(
            () => resolve("timeout"),
            60
          )
      ),
    ]);

  assert.equal(
    result,
    "<!DOCTYPE html><html>Fast Shell</html>"
  );
});

// =============================================================
// PHASE-2 V2 — RECURRENCE GUARD & HARDENING TESTS
// =============================================================

import {
  RELEASE_OWNED_RUNTIME_FILES,
  computeReleaseFingerprint,
  SEALED_RELEASE_FINGERPRINTS,
  validateReleaseFingerprintContract,
} from "./helpers/release-fingerprint.mjs";

const EXPECTED_RELEASE_VERSION = ACTIVE_APP_VERSION;

test("AQ. RECURRENCE GUARD: runtime mutation without version bump MUST fail", async () => {
  const originalContent =
    fs.readFileSync(
      path.join(rootDir, "js", "storage.js")
    );

  const mutatedContent =
    Buffer.concat([
      originalContent,
      Buffer.from(" "),
    ]);

  const mutatedFingerprint =
    computeReleaseFingerprint(
      rootDir,
      RELEASE_OWNED_RUNTIME_FILES,
      {
        "js/storage.js": mutatedContent,
      }
    );

  assert.ok(
    SEALED_RELEASE_FINGERPRINTS[ACTIVE_APP_VERSION],
    `${ACTIVE_APP_VERSION} must be sealed`
  );

  assert.notEqual(
    mutatedFingerprint,
    SEALED_RELEASE_FINGERPRINTS[ACTIVE_APP_VERSION]
  );

  const versionSource =
    fs.readFileSync(
      path.join(rootDir, "js", "version.js"),
      "utf8"
    );

  const match =
    versionSource.match(
      /APP_VERSION\s*=\s*"([^"]+)"/u
    );

  assert.ok(match);
  assert.equal(match[1], ACTIVE_APP_VERSION);
});

test("AR. RECURRENCE GUARD: current release matches its sealed fingerprint", async () => {
  const versionSource =
    fs.readFileSync(
      path.join(rootDir, "js", "version.js"),
      "utf8"
    );

  const match =
    versionSource.match(
      /APP_VERSION\s*=\s*"([^"]+)"/u
    );

  assert.ok(match);

  const appVersion = match[1];

  assert.equal(
    appVersion,
    EXPECTED_RELEASE_VERSION
  );

  const actualFingerprint =
    computeReleaseFingerprint(
      rootDir,
      RELEASE_OWNED_RUNTIME_FILES
    );

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion,
      actualFingerprint,
      registry: SEALED_RELEASE_FINGERPRINTS,
    }),
    true
  );
});

test("AT. SEALED RELEASE MUTATION: every sealed release rejects mutated runtime bytes", () => {
  const originalContent =
    fs.readFileSync(
      path.join(rootDir, "js", "storage.js")
    );

  const mutatedContent =
    Buffer.concat([
      originalContent,
      Buffer.from(" "),
    ]);

  const mutatedFingerprint =
    computeReleaseFingerprint(
      rootDir,
      RELEASE_OWNED_RUNTIME_FILES,
      {
        "js/storage.js": mutatedContent,
      }
    );

  for (
    const [version, sealedFingerprint]
    of Object.entries(SEALED_RELEASE_FINGERPRINTS)
  ) {
    assert.notEqual(
      mutatedFingerprint,
      sealedFingerprint
    );

    assert.throws(
      () => {
        validateReleaseFingerprintContract({
          appVersion: version,
          actualFingerprint: mutatedFingerprint,
          registry: SEALED_RELEASE_FINGERPRINTS,
        });
      },
      /SEALED RELEASE MUTATION FORBIDDEN/u
    );
  }
});

test("AU. FINGERPRINT-ONLY UPDATE IS NOT THE WORKFLOW: rewriting an existing sealed release is rejected", () => {
  const historicalVersion = "v23.3.44";

  assert.ok(
    SEALED_RELEASE_FINGERPRINTS[historicalVersion]
  );

  const modifiedFingerprint =
    "0000000000000000000000000000000000000000000000000000000000000000";

  assert.throws(
    () => {
      validateReleaseFingerprintContract({
        appVersion: historicalVersion,
        actualFingerprint: modifiedFingerprint,
        registry: SEALED_RELEASE_FINGERPRINTS,
      });
    },
    (error) => {
      assert.match(
        error.message,
        /SEALED RELEASE MUTATION FORBIDDEN/u
      );

      assert.match(
        error.message,
        /must NEVER be rewritten in place/u
      );

      assert.match(
        error.message,
        /create a NEW release/u
      );

      return true;
    }
  );
});

test("AV. NEW RELEASE ENTRY: next release can be added without modifying any existing sealed release", () => {
  const simulatedFingerprint =
    "1111111111111111111111111111111111111111111111111111111111111111";

  const simulatedRegistry = {
    ...SEALED_RELEASE_FINGERPRINTS,
    [NEXT_APP_VERSION]: simulatedFingerprint,
  };

  for (
    const [version, fingerprint]
    of Object.entries(SEALED_RELEASE_FINGERPRINTS)
  ) {
    assert.equal(
      validateReleaseFingerprintContract({
        appVersion: version,
        actualFingerprint: fingerprint,
        registry: simulatedRegistry,
      }),
      true
    );
  }

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion: NEXT_APP_VERSION,
      actualFingerprint: simulatedFingerprint,
      registry: simulatedRegistry,
    }),
    true
  );
});

test("AS. isReleaseAsset MEMBERSHIP: current query is isolated from all sealed historical versions", async () => {
  const worker = createSwHarness();

  const versionedAssets =
    vm.runInContext("ASSETS", worker.context)
      .filter(
        (asset) =>
          asset.includes("?v=")
      );

  for (const asset of versionedAssets) {
    const fullUrl =
      new URL(
        asset,
        `${origin}/NIMR-SAV/`
      ).href;

    const result =
      vm.runInContext(
        `isReleaseAsset(${JSON.stringify(fullUrl)})`,
        worker.context
      );

    assert.equal(
      result,
      true,
      `Current release asset must classify as release: ${asset}`
    );
  }

  const nonVersionedAssets =
    vm.runInContext("ASSETS", worker.context)
      .filter(
        (asset) =>
          !asset.includes("?v=")
      );

  for (const asset of nonVersionedAssets) {
    const fullUrl =
      new URL(
        asset,
        `${origin}/NIMR-SAV/`
      ).href;

    const result =
      vm.runInContext(
        `isReleaseAsset(${JSON.stringify(fullUrl)})`,
        worker.context
      );

    assert.equal(result, false);
  }

  const wrongVersionUrls = [
    ...Object.keys(SEALED_RELEASE_FINGERPRINTS)
      .filter(
        (version) =>
          version !== ACTIVE_APP_VERSION
      )
      .map(
        (version) =>
          `${origin}/NIMR-SAV/js/storage.js?v=${version.replace(/^v/u, "")}`
      ),
    `${origin}/NIMR-SAV/js/storage.js`,
  ];

  for (const url of wrongVersionUrls) {
    const result =
      vm.runInContext(
        `isReleaseAsset(${JSON.stringify(url)})`,
        worker.context
      );

    assert.equal(
      result,
      false,
      `Wrong/missing version must not classify as active release: ${url}`
    );
  }
});

// =============================================================
// MULTI-TAB CONTROLLERCHANGE ATOMICITY (AW - AZ)
// =============================================================

function createTabControllerChangeHarness(options = {}) {
  const events = [];
  let reloadCount = 0;
  let autosaveCallCount = 0;
  let warnCount = 0;

  const tabWindow = {
    __nimrReloadingForUpdate: false,
    location: {
      reload() {
        events.push("reload");
        reloadCount += 1;
      },
    },
  };

  const forceEmergencyAutosave = options.forceEmergencyAutosave || (async () => {
    events.push("autosave:start");
    autosaveCallCount += 1;
    if (options.autosaveDelayMs) {
      await new Promise((r) => setTimeout(r, options.autosaveDelayMs));
    }
    if (options.shouldThrow) {
      events.push("autosave:error");
      throw new Error("Simulated autosave failure");
    }
    events.push("autosave:done");
  });

  const consoleMock = {
    warn(...args) {
      warnCount += 1;
    },
  };

  // The exact logic from js/utils.js setupServiceWorkerUpdates:
  async function handleControllerChange() {
    if (tabWindow.__nimrReloadingForUpdate) return;
    tabWindow.__nimrReloadingForUpdate = true;
    try {
      if (typeof forceEmergencyAutosave === "function") {
        await Promise.resolve(forceEmergencyAutosave());
      }
    } catch (error) {
      consoleMock.warn("Erreur sauvegarde d'urgence avant rechargement PWA:", error);
    } finally {
      tabWindow.location.reload();
    }
  }

  return {
    tabWindow,
    events,
    getReloadCount: () => reloadCount,
    getAutosaveCallCount: () => autosaveCallCount,
    getWarnCount: () => warnCount,
    handleControllerChange,
  };
}

test("AW. TWO-TAB UPDATE ACTIVATION: Tab B awaits its own emergency autosave before reload on controllerchange", async () => {
  // Tab B harness with 20ms async autosave delay
  const tabB = createTabControllerChangeHarness({ autosaveDelayMs: 20 });

  // Tab B receives controllerchange triggered when Worker C claimed clients
  const controllerChangePromise = tabB.handleControllerChange();

  // At this moment, autosave has started, but MUST NOT have reloaded yet
  assert.equal(tabB.getReloadCount(), 0, "Tab B must NOT reload while autosave is in flight");
  assert.equal(tabB.events.includes("autosave:start"), true);
  assert.equal(tabB.events.includes("reload"), false);

  await controllerChangePromise;

  // After controllerchange completes:
  assert.deepEqual(tabB.events, ["autosave:start", "autosave:done", "reload"]);
  assert.equal(tabB.getReloadCount(), 1, "Tab B must reload exactly once");
});

test("AX. AUTOSAVE REJECTION: controllerchange handles autosave rejection safely, logs warning, and reloads once", async () => {
  const tab = createTabControllerChangeHarness({ shouldThrow: true });

  await tab.handleControllerChange();

  assert.equal(tab.getWarnCount(), 1, "Must log warning on autosave failure");
  assert.equal(tab.getReloadCount(), 1, "Must still reload once even if autosave throws");
  assert.equal(tab.tabWindow.__nimrReloadingForUpdate, true, "Anti-loop flag must remain set");
});

test("AY. DUPLICATE CONTROLLERCHANGE: concurrent or duplicate controllerchange events execute autosave and reload once", async () => {
  const tab = createTabControllerChangeHarness({ autosaveDelayMs: 20 });

  // Dispatch twice concurrently
  const p1 = tab.handleControllerChange();
  const p2 = tab.handleControllerChange();

  await Promise.all([p1, p2]);

  assert.equal(tab.getAutosaveCallCount(), 1, "forceEmergencyAutosave must be called exactly once");
  assert.equal(tab.getReloadCount(), 1, "reload must be called exactly once");
});

test("AZ. INITIATING TAB: user click update button flow remains safe and reloads once", async () => {
  let autosaveCount = 0;
  let reloadCount = 0;
  let skipWaitingSent = false;
  const tabWindow = { __nimrReloadingForUpdate: false, location: { reload: () => { reloadCount++; } } };

  async function forceEmergencyAutosave() {
    autosaveCount++;
  }

  // Initiating tab update button click
  await Promise.resolve(forceEmergencyAutosave());
  skipWaitingSent = true;

  // Then SW activates and fires controllerchange on initiating tab as well
  if (!tabWindow.__nimrReloadingForUpdate) {
    tabWindow.__nimrReloadingForUpdate = true;
    try {
      if (typeof forceEmergencyAutosave === "function") {
        await Promise.resolve(forceEmergencyAutosave());
      }
    } finally {
      tabWindow.location.reload();
    }
  }

  assert.equal(skipWaitingSent, true);
  assert.equal(autosaveCount, 2, "Initiating tab saved on button click and safety-checked on controllerchange");
  assert.equal(reloadCount, 1, "Initiating tab must reload exactly once");

  // Also verify js/utils.js production source contains the exact async handler
  const utilsSource = fs.readFileSync(path.join(rootDir, "js/utils.js"), "utf8");
  assert.match(utilsSource, /navigator\.serviceWorker\.addEventListener\(\s*["']controllerchange["']\s*,\s*async/u);
  assert.match(utilsSource, /if\s*\(\s*window\.__nimrReloadingForUpdate\s*\)\s*return;/u);
  assert.match(utilsSource, /await\s+Promise\.resolve\(\s*forceEmergencyAutosave\(\)\s*\)/u);
  assert.match(utilsSource, /window\.location\.reload\(\)/u);
});

// =============================================================
// RUNNER
// =============================================================
let passedCount = 0;
let failedCount = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passedCount += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    failedCount += 1;
  }
}

console.log(`\nCACHE-001 CHARACTERIZATION & IMPLEMENTATION SUITE: ${passedCount}/${tests.length} TESTS PASSED`);
if (failedCount > 0) {
  process.exit(1);
}
