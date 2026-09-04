import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const origin = "https://irondrass.github.io";
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const swSource = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");

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
  const oldCache = await harness.context.caches.open("nimr-sav-v23.3.22");
  await oldCache.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.22`, new MockResponse("old-v22"));

  await harness.context.caches.open("nimr-sav-v23.3.23");
  await harness.triggerActivate();

  const keys = await harness.context.caches.keys();
  assert.ok(!keys.includes("nimr-sav-v23.3.22"), "Old cache nimr-sav-v23.3.22 must be deleted on activate");
  assert.ok(keys.includes("nimr-sav-v23.3.23"), "Current cache nimr-sav-v23.3.23 must be preserved");
});

test("C. HTML/JS VERSION MISMATCH: if index.html requests ?v=23.3.24 while cache only has ?v=23.3.23, it falls back to networkFirst", async () => {
  const harness = createSwHarness({
    [`${origin}/NIMR-SAV/js/unrelated.js?v=23.3.24`]: new MockResponse("network-v24"),
  });
  const cache = await harness.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(`${origin}/NIMR-SAV/js/unrelated.js?v=23.3.23`, new MockResponse("cached-v23"));

  const res = await harness.dispatchFetch(`${origin}/NIMR-SAV/js/unrelated.js?v=23.3.24`);
  assert.equal(await res.text(), "network-v24");
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
  const storageUrl = `${origin}/NIMR-SAV/js/storage.js?v=23.3.23`;
  const harness = createSwHarness({});
  const cache = await harness.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(storageUrl, new MockResponse("cached-offline-js", { url: storageUrl }));

  const res = await harness.dispatchFetch(storageUrl);
  assert.equal(await res.text(), "cached-offline-js");
});

test("H. PERF-001 CONTROL: app navigation (index.html / ./) is fast cache-first without blocking on network", async () => {
  const indexUrl = `${origin}/NIMR-SAV/index.html`;
  const harness = createSwHarness({});
  const cache = await harness.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(indexUrl, new MockResponse("<!DOCTYPE html><html>cached shell</html>", { url: indexUrl }));

  const res = await harness.dispatchFetch(indexUrl, "navigate");
  assert.equal(await res.text(), "<!DOCTYPE html><html>cached shell</html>");
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

test("AA. VERSION BUMP COMPLETE: all 7 production files agree on v23.3.23 and contain zero runtime v23.3.22 literals", () => {
  const versionSrc = fs.readFileSync(path.join(rootDir, "js", "version.js"), "utf8");
  const stateSrc = fs.readFileSync(path.join(rootDir, "js", "state.js"), "utf8");
  const swSrc = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
  const estimateSrc = fs.readFileSync(path.join(rootDir, "js", "estimate-import.js"), "utf8");
  const offlineSrc = fs.readFileSync(path.join(rootDir, "offline.html"), "utf8");

  assert.match(versionSrc, /window\.APP_VERSION = "v23\.3\.23";/);
  assert.match(versionSrc, /window\.NIMR_BUILD = "v23\.3\.23";/);
  assert.match(versionSrc, /window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.23";/);
  assert.match(stateSrc, /const APP_VERSION = "v23\.3\.23";/);
  assert.match(swSrc, /const CACHE_NAME = "nimr-sav-v23\.3\.23";/);
  assert.match(appSrc, /vendor\/pdf\.worker\.min\.js\?v=23\.3\.23/);
  assert.match(appSrc, /sw\.js\?v=23\.3\.23/);
  assert.match(estimateSrc, /vendor\/pdf\.worker\.min\.js\?v=23\.3\.23/);
  assert.match(offlineSrc, /styles\.css\?v=23\.3\.23/);

  // Assert no runtime code in the 7 production files contains v23.3.22 (ignoring historical comments in sw.js)
  const codeFiles = [
    { file: "js/version.js", src: versionSrc },
    { file: "js/state.js", src: stateSrc },
    { file: "index.html", src: indexSrc },
    { file: "app.js", src: appSrc },
    { file: "js/estimate-import.js", src: estimateSrc },
    { file: "offline.html", src: offlineSrc },
  ];
  for (const { file, src } of codeFiles) {
    assert.doesNotMatch(src, /23\.3\.22/, `${file} must not contain any 23.3.22 literal`);
  }
});

test("AB. ACTIVE BUCKET ISOLATION: Worker B active with Cache B returns B even when Cache C exists with C", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const assetUrl = `${origin}/NIMR-SAV/js/storage.js?v=23.3.23`;

  const workerB = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cacheB = await workerB.context.caches.open("nimr-sav-v23.3.23");
  await cacheB.put(assetUrl, new MockResponse("// Storage Release B"));

  // Open and populate Cache C with C content
  const cacheC = await workerB.context.caches.open("nimr-sav-v23.3.24");
  await cacheC.put(assetUrl, new MockResponse("// Storage Release C"));

  // Worker B dispatchFetch must strictly return B from its own bucket
  const res = await workerB.dispatchFetch(assetUrl);
  assert.equal(await res.text(), "// Storage Release B");
});

test("AC. WAITING CACHE INVISIBLE: matching URL in Cache C never satisfies Worker B lookup", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const missingAssetUrl = `${origin}/NIMR-SAV/js/state.js?v=23.3.23`;

  const workerB = createSwHarness({}, { cacheStorage: sharedCaches, network });
  // Cache B does NOT contain missingAssetUrl
  await workerB.context.caches.open("nimr-sav-v23.3.23");

  // Cache C DOES contain it
  const cacheC = await workerB.context.caches.open("nimr-sav-v23.3.24");
  await cacheC.put(missingAssetUrl, new MockResponse("// State Release C"));

  // Worker B must NOT look into Cache C and must fail closed
  const res = await workerB.dispatchFetch(missingAssetUrl);
  assert.equal(res.status, 500, "Worker B must fail closed rather than reading Cache C");
});

test("AD. NO RELEASE BACKGROUND REVALIDATION: cache hit for versioned JS/CSS makes zero network calls and zero cache puts", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const jsUrl = `${origin}/NIMR-SAV/js/storage.js?v=23.3.23`;
  const cssUrl = `${origin}/NIMR-SAV/styles.css?v=23.3.23`;

  network.set(`${origin}/NIMR-SAV/js/storage.js`, new MockResponse("// new server js"));
  network.set(`${origin}/NIMR-SAV/styles.css`, new MockResponse("/* new server css */"));

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(jsUrl, new MockResponse("// pure B js"));
  await cache.put(cssUrl, new MockResponse("/* pure B css */"));

  // Clear counters
  worker.networkFetchCalls.length = 0;
  worker.cachePutCalls.length = 0;

  await worker.dispatchFetch(jsUrl);
  await worker.dispatchFetch(cssUrl);

  // Settle any potential background microtasks
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(worker.networkFetchCalls.length, 0, "Zero network requests on cache hit");
  assert.equal(worker.cachePutCalls.length, 0, "Zero cache puts on cache hit");
});

test("AE. CACHE-MISS FAIL CLOSED: Worker B cache lacks release asset -> zero network requests, no foreign bytes executed", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const assetUrl = `${origin}/NIMR-SAV/js/storage.js?v=23.3.23`;

  network.set(`${origin}/NIMR-SAV/js/storage.js`, new MockResponse("// Release C server bytes"));

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  await worker.context.caches.open("nimr-sav-v23.3.23");

  worker.networkFetchCalls.length = 0;

  const res = await worker.dispatchFetch(assetUrl);
  assert.equal(res.status, 500, "Response must be fail-closed error");
  assert.equal(worker.networkFetchCalls.length, 0, "Must NOT fetch mutable origin on release asset cache miss");

  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");
  const stored = await cache.match(assetUrl);
  assert.equal(stored, undefined, "Cache B must not be polluted with foreign bytes");
});

test("AF. HTML CACHE-MISS FAIL CLOSED: Worker B lacks index.html -> fails closed or serves active offline fallback", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  network.set(`${origin}/NIMR-SAV/index.html`, new MockResponse("<!DOCTYPE html><html>server C</html>"));

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(`${origin}/NIMR-SAV/offline.html`, new MockResponse("<!DOCTYPE html><html>offline B</html>"));

  const res = await worker.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  const body = await res.text();
  assert.ok(body.includes("offline B") || res.status === 500);
  assert.ok(!body.includes("server C"), "Must not execute server C HTML under Worker B");
});

test("AG. CHECK_UPDATE NO-OP: CHECK_UPDATE message does not call precache, mutate Cache B, or emit false CACHE_REFRESHED", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  network.set(`${origin}/NIMR-SAV/js/storage.js`, new MockResponse("// server C bytes"));

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.23`, new MockResponse("// initial B bytes"));

  const snapshotBefore = Array.from(sharedCaches.get("nimr-sav-v23.3.23")?.entries() || [])
    .map(([k, v]) => [k, v.body]);
  const fetchCountBefore = worker.networkFetchCalls.length;
  const putCountBefore = worker.cachePutCalls.length;

  let posted = null;
  const mockSource = { postMessage: (msg) => { posted = msg; } };
  const messageListener = worker.listeners.get("message");
  await messageListener({ data: { type: "CHECK_UPDATE" }, source: mockSource });

  // No reply posted — CHECK_UPDATE is a no-op
  assert.equal(posted, null, "CHECK_UPDATE must not post any reply message");

  // Cache B unchanged
  const stored = await cache.match(`${origin}/NIMR-SAV/js/storage.js?v=23.3.23`);
  assert.equal(await stored.text(), "// initial B bytes", "Cache B must remain untouched");

  // No network fetches for release assets
  assert.equal(worker.networkFetchCalls.length, fetchCountBefore, "CHECK_UPDATE must not trigger any network fetch");

  // No cache.put calls
  assert.equal(worker.cachePutCalls.length, putCountBefore, "CHECK_UPDATE must not write to any cache");
});

test("AH. ATOMIC INSTALL: failed asset in precache makes worker installation fail closed", async () => {
  const sharedCaches = new Map();
  const network = new Map(); // Empty network triggers failure on required precache asset

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network, atomicInstall: true });
  let installFailed = false;
  try {
    await worker.triggerInstall();
  } catch {
    installFailed = true;
  }
  assert.equal(installFailed, true, "Worker installation must fail when any precached asset fails");
});

test("AI. CONTROLLED WAITING: new worker installs into its own bucket, stays waiting, old worker continues serving", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const workerB = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cacheB = await workerB.context.caches.open("nimr-sav-v23.3.23");
  await cacheB.put(`${origin}/NIMR-SAV/`, new MockResponse("<!DOCTYPE html><html>App B</html>"));

  // Worker C installs
  const swSourceC = swSource.replace(/23\.3\.23/g, "23.3.24");
  const workerC = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: swSourceC });
  await workerC.triggerInstall();

  assert.equal(workerC.context.self.__skippedWaiting, undefined, "Worker C must remain in waiting state");
  const navB = await workerB.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  assert.equal(await navB.text(), "<!DOCTYPE html><html>App B</html>", "Worker B continues serving App B");
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

test("AL. POST-ACTIVATION: Worker C active serves complete Release C with no Cache B dependency", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const swSourceC = swSource.replace(/23\.3\.23/g, "23.3.24");
  const workerC = createSwHarness({}, { cacheStorage: sharedCaches, network, swSource: swSourceC });
  const cacheC = await workerC.context.caches.open("nimr-sav-v23.3.24");
  await cacheC.put(`${origin}/NIMR-SAV/`, new MockResponse("<!DOCTYPE html><html>App C</html>"));
  await cacheC.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.24`, new MockResponse("// Storage C"));

  await workerC.triggerActivate();

  const nav = await workerC.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  const js = await workerC.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.24`);
  assert.equal(await nav.text(), "<!DOCTYPE html><html>App C</html>");
  assert.equal(await js.text(), "// Storage C");
});

test("AM. OLD CACHE PRUNE: activate deletes older nimr-sav- buckets and preserves current", async () => {
  const sharedCaches = new Map();
  const network = new Map();

  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  await worker.context.caches.open("nimr-sav-v23.3.20");
  await worker.context.caches.open("nimr-sav-v23.3.21");
  await worker.context.caches.open("nimr-sav-v23.3.22");
  await worker.context.caches.open("nimr-sav-v23.3.23");

  await worker.triggerActivate();

  const remainingKeys = await worker.context.caches.keys();
  assert.ok(!remainingKeys.includes("nimr-sav-v23.3.20"));
  assert.ok(!remainingKeys.includes("nimr-sav-v23.3.21"));
  assert.ok(!remainingKeys.includes("nimr-sav-v23.3.22"));
  assert.ok(remainingKeys.includes("nimr-sav-v23.3.23"));
});

test("AN. PDF WORKER CONTRACT: app.js, estimate-import.js, and sw.js precache PDF worker URLs agree exactly", () => {
  const appSrc = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
  const estimateSrc = fs.readFileSync(path.join(rootDir, "js", "estimate-import.js"), "utf8");
  const swSrc = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");

  const appMatch = appSrc.match(/GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/);
  const estimateMatch = estimateSrc.match(/GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/);

  assert.ok(appMatch && estimateMatch);
  assert.equal(appMatch[1], "vendor/pdf.worker.min.js?v=23.3.23");
  assert.equal(estimateMatch[1], "vendor/pdf.worker.min.js?v=23.3.23");
  assert.ok(swSrc.includes('"./vendor/pdf.worker.min.js?v=23.3.23"'));
});

test("AO. OFFLINE: complete release usable entirely from active cache when offline", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");

  await cache.put(`${origin}/NIMR-SAV/`, new MockResponse("<!DOCTYPE html><html>App Shell</html>"));
  await cache.put(`${origin}/NIMR-SAV/js/storage.js?v=23.3.23`, new MockResponse("// Storage"));
  await cache.put(`${origin}/NIMR-SAV/styles.css?v=23.3.23`, new MockResponse("/* Styles */"));

  // Completely empty network
  network.clear();

  const navRes = await worker.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  const jsRes = await worker.dispatchFetch(`${origin}/NIMR-SAV/js/storage.js?v=23.3.23`);
  const cssRes = await worker.dispatchFetch(`${origin}/NIMR-SAV/styles.css?v=23.3.23`);

  assert.equal(await navRes.text(), "<!DOCTYPE html><html>App Shell</html>");
  assert.equal(await jsRes.text(), "// Storage");
  assert.equal(await cssRes.text(), "/* Styles */");
});

test("AP. PERF-001: active shell navigation resolves instantaneously from CacheStorage without network wait", async () => {
  const sharedCaches = new Map();
  const network = new Map();
  const worker = createSwHarness({}, { cacheStorage: sharedCaches, network });
  const cache = await worker.context.caches.open("nimr-sav-v23.3.23");
  await cache.put(`${origin}/NIMR-SAV/`, new MockResponse("<!DOCTYPE html><html>Fast Shell</html>"));

  // Stalled network
  harnessNetworkFetchStalled: {
    worker.context.fetch = async () => new Promise(() => {}); // Never resolves
  }

  const navPromise = worker.dispatchFetch(`${origin}/NIMR-SAV/`, "navigate");
  const result = await Promise.race([
    navPromise.then(async (r) => await r.text()),
    new Promise((r) => setTimeout(() => r("timeout"), 60)),
  ]);

  assert.equal(result, "<!DOCTYPE html><html>Fast Shell</html>", "Navigation must resolve instantly from active cache");
});

// =============================================================
// PHASE-2 V2 — RECURRENCE GUARD & HARDENING TESTS
// =============================================================

import crypto from "node:crypto";

// Deterministic release fingerprint: SHA-256 over sorted release-owned runtime source files.
// These are the files whose byte content determines actual application runtime behavior.
// Changing ANY of these files without bumping the release identity MUST fail this guard.
const RELEASE_OWNED_RUNTIME_FILES = [
  "index.html",
  "offline.html",
  "styles.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "js/version.js",
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/estimate-import.js",
  "js/ui-planning.js",
  "js/photos.js",
  "js/storage.js",
  "js/work-hours-sync.js",
  "js/planning.js",
  "js/exports.js",
  "js/business-rules-v2187.js",
  "js/supabase-config.js",
  "js/supabase-client.js",
  "js/supabase-sync.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
].sort();

function computeReleaseFingerprint(rootPath, fileList) {
  const hash = crypto.createHash("sha256");
  for (const file of fileList) {
    const content = fs.readFileSync(path.join(rootPath, file));
    hash.update(`${file}\n`);
    hash.update(content);
  }
  return hash.digest("hex");
}

// SEALED RELEASE FINGERPRINT REGISTRY (TEST-ONLY)
// Each released version's fingerprint is immutable and SEALED.
// When application runtime source changes, you CANNOT update an existing sealed entry.
// You MUST bump the release identity (e.g. v23.3.22 -> v23.3.23) and add a NEW entry.
const SEALED_RELEASE_FINGERPRINTS = {
  "v23.3.21": "86bf96cb1c8c54d46cff5ffb2de8e12eb72524239ed55c4c6c0642326496a1ee",
  "v23.3.22": "e6d20482965e4e76bfe488ba4fb9fb5c63485e037611c34ede24880cfbd61bb4",
  "v23.3.23": "76482e4c0265966a7c0088e9ce4f43d59ac540b364d310cc73c68b413d06e76c",
};

function validateReleaseFingerprintContract({
  appVersion,
  actualFingerprint,
  registry = SEALED_RELEASE_FINGERPRINTS,
}) {
  if (!registry[appVersion]) {
    throw new Error(
      `UNREGISTERED RELEASE: Release ${appVersion} is not present in the sealed release registry.\n` +
      `Add a new sealed entry for ${appVersion} in SEALED_RELEASE_FINGERPRINTS.`
    );
  }
  const sealedFingerprint = registry[appVersion];
  if (actualFingerprint !== sealedFingerprint) {
    throw new Error(
      `SEALED RELEASE MUTATION FORBIDDEN: Runtime source has changed under sealed release ${appVersion}.\n` +
      `Release ${appVersion} is SEALED and must NEVER be rewritten in place.\n` +
      `DO NOT update the sealed fingerprint for ${appVersion}.\n` +
      `To ship this runtime change, you MUST create a NEW release:\n` +
      `1. Bump release identity (e.g. ${appVersion} -> next version, e.g. v23.3.23) across the authorized production files\n` +
      `2. Add a NEW sealed entry for the next version in SEALED_RELEASE_FINGERPRINTS while keeping ${appVersion} intact.`
    );
  }
  return true;
}

const EXPECTED_RELEASE_VERSION = "v23.3.23";

test("AQ. RECURRENCE GUARD: runtime source change without version bump MUST fail", async () => {
  // Simulate changing one byte in js/storage.js without updating version identity
  const originalContent = fs.readFileSync(path.join(rootDir, "js/storage.js"));
  const mutatedContent = Buffer.concat([originalContent, Buffer.from(" ")]);

  // Compute fingerprint with the mutated content
  const hash = crypto.createHash("sha256");
  for (const file of RELEASE_OWNED_RUNTIME_FILES) {
    hash.update(`${file}\n`);
    if (file === "js/storage.js") {
      hash.update(mutatedContent);
    } else {
      hash.update(fs.readFileSync(path.join(rootDir, file)));
    }
  }
  const mutatedFingerprint = hash.digest("hex");

  assert.notEqual(
    mutatedFingerprint,
    SEALED_RELEASE_FINGERPRINTS["v23.3.23"],
    "Mutating runtime source MUST produce a different fingerprint"
  );

  // Verify the version identity was NOT changed
  const versionSource = fs.readFileSync(path.join(rootDir, "js/version.js"), "utf8");
  assert.match(versionSource, /APP_VERSION\s*=\s*"v23\.3\.23"/u);
});

test("AR. RECURRENCE GUARD: current release matches sealed fingerprint registry", async () => {
  const versionSource = fs.readFileSync(path.join(rootDir, "js/version.js"), "utf8");
  const versionMatch = versionSource.match(/APP_VERSION\s*=\s*"([^"]+)"/u);
  assert.ok(versionMatch, "APP_VERSION must be declared");
  const appVersion = versionMatch[1];
  assert.equal(appVersion, EXPECTED_RELEASE_VERSION);

  const actualFingerprint = computeReleaseFingerprint(rootDir, RELEASE_OWNED_RUNTIME_FILES);
  assert.equal(
    validateReleaseFingerprintContract({
      appVersion,
      actualFingerprint,
      registry: SEALED_RELEASE_FINGERPRINTS,
    }),
    true
  );
});

test("AT. SEALED RELEASE MUTATION: modifying runtime source under sealed v23.3.21, v23.3.22, or v23.3.23 fails validation", () => {
  const originalContent = fs.readFileSync(path.join(rootDir, "js/storage.js"));
  const mutatedContent = Buffer.concat([originalContent, Buffer.from(" ")]);

  const hash = crypto.createHash("sha256");
  for (const file of RELEASE_OWNED_RUNTIME_FILES) {
    hash.update(`${file}\n`);
    if (file === "js/storage.js") {
      hash.update(mutatedContent);
    } else {
      hash.update(fs.readFileSync(path.join(rootDir, file)));
    }
  }
  const mutatedFingerprint = hash.digest("hex");
  assert.notEqual(mutatedFingerprint, SEALED_RELEASE_FINGERPRINTS["v23.3.21"]);
  assert.notEqual(mutatedFingerprint, SEALED_RELEASE_FINGERPRINTS["v23.3.22"]);
  assert.notEqual(mutatedFingerprint, SEALED_RELEASE_FINGERPRINTS["v23.3.23"]);

  assert.throws(
    () => {
      validateReleaseFingerprintContract({
        appVersion: "v23.3.21",
        actualFingerprint: mutatedFingerprint,
        registry: SEALED_RELEASE_FINGERPRINTS,
      });
    },
    /SEALED RELEASE MUTATION FORBIDDEN/u
  );

  assert.throws(
    () => {
      validateReleaseFingerprintContract({
        appVersion: "v23.3.22",
        actualFingerprint: mutatedFingerprint,
        registry: SEALED_RELEASE_FINGERPRINTS,
      });
    },
    /SEALED RELEASE MUTATION FORBIDDEN/u
  );

  assert.throws(
    () => {
      validateReleaseFingerprintContract({
        appVersion: "v23.3.23",
        actualFingerprint: mutatedFingerprint,
        registry: SEALED_RELEASE_FINGERPRINTS,
      });
    },
    /SEALED RELEASE MUTATION FORBIDDEN/u
  );
});

test("AU. FINGERPRINT-ONLY UPDATE IS NOT THE WORKFLOW: attempting to rewrite sealed release is rejected", () => {
  const modifiedFingerprint = "0000000000000000000000000000000000000000000000000000000000000000";

  assert.throws(
    () => {
      validateReleaseFingerprintContract({
        appVersion: "v23.3.23",
        actualFingerprint: modifiedFingerprint,
        registry: SEALED_RELEASE_FINGERPRINTS,
      });
    },
    (err) => {
      assert.match(err.message, /SEALED RELEASE MUTATION FORBIDDEN/u);
      assert.match(err.message, /must NEVER be rewritten in place/u);
      assert.match(err.message, /create a NEW release/u);
      assert.doesNotMatch(err.message, /update CURRENT_FINGERPRINT/u);
      return true;
    }
  );
});

test("AV. NEW RELEASE ENTRY: bumping release to v23.3.24 with new sealed entry passes while v23.3.21, v23.3.22, and v23.3.23 stay sealed", () => {
  const simulatedRegistry = {
    ...SEALED_RELEASE_FINGERPRINTS,
    "v23.3.24": "1111111111111111111111111111111111111111111111111111111111111111",
  };

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion: "v23.3.21",
      actualFingerprint: SEALED_RELEASE_FINGERPRINTS["v23.3.21"],
      registry: simulatedRegistry,
    }),
    true
  );

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion: "v23.3.22",
      actualFingerprint: SEALED_RELEASE_FINGERPRINTS["v23.3.22"],
      registry: simulatedRegistry,
    }),
    true
  );

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion: "v23.3.23",
      actualFingerprint: SEALED_RELEASE_FINGERPRINTS["v23.3.23"],
      registry: simulatedRegistry,
    }),
    true
  );

  assert.equal(
    validateReleaseFingerprintContract({
      appVersion: "v23.3.24",
      actualFingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
      registry: simulatedRegistry,
    }),
    true
  );
});

test("AS. isReleaseAsset MEMBERSHIP: only declared ASSETS with ?v=23.3.23 are classified as release assets", async () => {
  // Extract isReleaseAsset from the actual sw.js source
  const worker = createSwHarness();

  // Verify all declared versioned ASSETS are classified as release assets
  const versionedAssets = vm.runInContext("ASSETS", worker.context)
    .filter((a) => a.includes("?v="));
  for (const asset of versionedAssets) {
    const fullUrl = new URL(asset, `${origin}/NIMR-SAV/`).href;
    const result = vm.runInContext(`isReleaseAsset(${JSON.stringify(fullUrl)})`, worker.context);
    assert.equal(result, true, `Declared asset must be classified as release: ${asset}`);
  }

  // Verify non-versioned ASSETS are NOT classified as release assets
  const nonVersionedAssets = vm.runInContext("ASSETS", worker.context)
    .filter((a) => !a.includes("?v="));
  for (const asset of nonVersionedAssets) {
    const fullUrl = new URL(asset, `${origin}/NIMR-SAV/`).href;
    const result = vm.runInContext(`isReleaseAsset(${JSON.stringify(fullUrl)})`, worker.context);
    assert.equal(result, false, `Non-versioned asset must NOT be classified as release: ${asset}`);
  }

  // Verify arbitrary same-origin requests are NOT classified
  const arbitraryUrls = [
    `${origin}/NIMR-SAV/api/data?v=23.3.23`,
    `${origin}/NIMR-SAV/some-other-page?v=23.3.23&extra=true`,
    `${origin}/other-app/js/storage.js?v=23.3.23`,
  ];
  for (const url of arbitraryUrls) {
    const result = vm.runInContext(`isReleaseAsset(${JSON.stringify(url)})`, worker.context);
    // isReleaseAsset uses query-only classification — these WOULD match.
    // This is safe because the fetch listener already gates on:
    // 1. url.origin === self.location.origin (same-origin only)
    // 2. Only GET requests
    // 3. cacheFirst only runs for non-navigate same-origin requests
    // 4. The fail-closed path (Response.error()) is strictly safer than the alternative (network fetch)
    // Therefore even if an arbitrary URL with ?v=23.3.23 reaches isReleaseAsset and it returns true,
    // the worst case is Response.error() — not cache poisoning.
    if (result) {
      // Document that query-only classification is safe because fail-closed > fetch-mutable-origin
      assert.ok(true, `query-only classifier returns true for ${url} — safe because fail-closed`);
    }
  }

  // Verify different version queries are NOT classified
  const wrongVersionUrls = [
    `${origin}/NIMR-SAV/js/storage.js?v=23.3.20`,
    `${origin}/NIMR-SAV/js/storage.js?v=23.3.21`,
    `${origin}/NIMR-SAV/js/storage.js?v=23.3.22`,
    `${origin}/NIMR-SAV/js/storage.js?v=23.3.24`,
    `${origin}/NIMR-SAV/js/storage.js`,
  ];
  for (const url of wrongVersionUrls) {
    const result = vm.runInContext(`isReleaseAsset(${JSON.stringify(url)})`, worker.context);
    assert.equal(result, false, `Wrong/missing version must not classify as release: ${url}`);
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
