import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const sw = read("sw.js");
const d1 = read("tests/identity_database_authority_hardening_identity001d1.test.mjs");

const passed = [];
const failed = [];
async function check(name, fn) {
  try { await fn(); passed.push(name); console.log(`PASS ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}: ${e.message}`); }
}

function fixture(cached = []) {
  const listeners = new Map();
  const entries = new Map(cached.map((u) => [u, new Response("cached", { status: 200 })]));
  const calls = [];
  let fetcher = async () => new Response("network", { status: 200 });
  const cache = {
    async match(req) {
      const key = typeof req === "string" ? req : req?.url;
      const r = entries.get(key);
      return r ? r.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === "string" ? req : req?.url;
      entries.set(key, res.clone());
    },
  };
  const selfObj = {
    location: {
      origin: "https://irondrass.github.io",
      href: "https://irondrass.github.io/NIMR-SAV/sw.js",
    },
    clients: { async claim() {}, async matchAll() { return []; } },
    addEventListener(type, cb) { listeners.set(type, cb); },
    skipWaiting() {},
  };
  const ctx = vm.createContext({
    self: selfObj,
    caches: {
      async open() { return cache; },
      async match(req) { return cache.match(req); },
      async keys() { return ["nimr-sav-v23.3.22"]; },
      async delete() { return true; },
    },
    fetch(req) { calls.push(req); return fetcher(req); },
    Request, Response, URL, console, Promise, setTimeout, clearTimeout,
  });
  vm.runInContext(sw, ctx, { filename: "sw.perf001.js" });
  return { listeners, calls, setFetcher(fn) { fetcher = fn; } };
}

function dispatch(fx, request) {
  let p = null;
  fx.listeners.get("fetch")?.({
    request,
    respondWith(value) { p = Promise.resolve(value); },
  });
  return p;
}

await check("A cache and app version remain v23.3.22", () => {
  assert.match(sw, /PERF-001 source refresh/u);
  assert.match(sw, /const CACHE_NAME = "nimr-sav-v23\.3\.22"/u);
  assert.match(read("js/version.js"), /^window\.APP_VERSION = "v23\.3\.22";$/mu);
});

await check("B D2-F service-worker marker remains intact", () => {
  assert.match(sw, /IDENTITY-001D2-F source refresh/u);
});

await check("C app root and index navigation are explicitly cache-first", () => {
  assert.match(sw, /const APP_BASE_PATH = new URL\("\.\/", self\.location\.href\)\.pathname/u);
  assert.match(sw, /isAppNavigation[\s\S]*?appNavigationFirst\(event\.request\)/u);
});

await check("D non-app navigations remain network-first", () => {
  assert.match(sw, /if \(event\.request\.mode === "navigate"\)[\s\S]*?networkFirst\(event\.request\)/u);
});

await check("E same-origin static requests use cacheFirst", () => {
  assert.match(sw, /event\.respondWith\(cacheFirst\(event\.request\)\)/u);
});

await check("F cached root resolves while GitHub revalidation is stalled", async () => {
  const u = "https://irondrass.github.io/NIMR-SAV/";
  const fx = fixture([u]);
  fx.setFetcher(() => new Promise(() => {}));
  const p = dispatch(fx, { method: "GET", mode: "navigate", url: u });
  const result = await Promise.race([
    p.then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("timeout"), 60)),
  ]);
  assert.equal(result, "resolved");
});

await check("G cached app.js resolves while GitHub revalidation is stalled", async () => {
  const u = "https://irondrass.github.io/NIMR-SAV/app.js?v=23.3.21";
  const fx = fixture([u]);
  fx.setFetcher(() => new Promise(() => {}));
  const p = dispatch(fx, { method: "GET", mode: "same-origin", url: u });
  const result = await Promise.race([
    p.then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("timeout"), 60)),
  ]);
  assert.equal(result, "resolved");
});

await check("H query navigation can use canonical cached index immediately", async () => {
  const fx = fixture(["./index.html"]);
  fx.setFetcher(() => new Promise(() => {}));
  const p = dispatch(fx, {
    method: "GET",
    mode: "navigate",
    url: "https://irondrass.github.io/NIMR-SAV/?shortcut=1",
  });
  const result = await Promise.race([
    p.then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("timeout"), 60)),
  ]);
  assert.equal(result, "resolved");
});

await check("I external Supabase/Auth requests are untouched", () => {
  const fx = fixture();
  const p = dispatch(fx, {
    method: "GET",
    mode: "cors",
    url: "https://example.supabase.co/auth/v1/user",
  });
  assert.equal(p, null);
  assert.equal(fx.calls.length, 0);
});

await check("J D1 whitelist includes PERF-001 and no privileged browser code is introduced", () => {
  assert.match(d1, /tests\/perf_fast_pwa_startup_perf001\.test\.mjs/u);
  assert.doesNotMatch(sw, /supabase\.co|workshop_members|service[_-]?role|auth\.admin/iu);
});

if (failed.length) {
  console.error(`\nPERF-001 REGRESSION SUITE: ${passed.length}/${passed.length + failed.length} CHECKS PASSED`);
  process.exitCode = 1;
} else {
  console.log(`\nPERF-001 REGRESSION SUITE: ${passed.length}/${passed.length} CHECKS PASSED`);
}
