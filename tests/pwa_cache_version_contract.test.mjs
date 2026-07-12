import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { currentBuild, getVersionedAssetQueries, repositoryRoot } from "./helpers/build_version.mjs";

const origin = "http://127.0.0.1:8787";
const swSource = fs.readFileSync(`${repositoryRoot}/sw.js`, "utf8");
const indexSource = fs.readFileSync(`${repositoryRoot}/index.html`, "utf8");
const offlineSource = fs.readFileSync(`${repositoryRoot}/offline.html`, "utf8");
const appSource = fs.readFileSync(`${repositoryRoot}/app.js`, "utf8");
const estimateImportSource = fs.readFileSync(`${repositoryRoot}/js/estimate-import.js`, "utf8");
const versionSource = fs.readFileSync(`${repositoryRoot}/js/version.js`, "utf8");
const storedResponses = new Map();

function absoluteCacheKey(input) {
  const value = input?.url || input;
  return new URL(String(value), `${origin}/`).href;
}

class TestRequest {
  constructor(input, options = {}) {
    this.url = absoluteCacheKey(input);
    this.method = options.method || input?.method || "GET";
    this.mode = options.mode || input?.mode || "same-origin";
  }
}

const cache = {
  async add(request) {
    const url = absoluteCacheKey(request);
    storedResponses.set(url, { ok: true, url, source: "precache" });
  },
  async put(request, response) {
    storedResponses.set(absoluteCacheKey(request), response);
  },
};

const listeners = new Map();
const context = {
  URL,
  Request: TestRequest,
  Response: { error: () => ({ ok: false, error: true }) },
  caches: {
    open: async () => cache,
    keys: async () => [currentBuild.cacheName],
    delete: async () => true,
    match: async (request) => storedResponses.get(absoluteCacheKey(request)),
  },
  fetch: async () => { throw new Error("offline"); },
  self: {
    location: { origin },
    addEventListener: (type, listener) => listeners.set(type, listener),
    clients: {
      claim: async () => {},
      matchAll: async () => [],
    },
    skipWaiting: () => {},
  },
  console,
};

vm.createContext(context);
vm.runInContext(swSource, context, { filename: "sw.js" });

const declaredCacheName = vm.runInContext("CACHE_NAME", context);
const declaredAssets = Array.from(vm.runInContext("ASSETS", context));
assert.equal(declaredCacheName, currentBuild.cacheName, "le service worker doit utiliser le cache déclaré dans js/version.js");
assert.equal(new Set(declaredAssets).size, declaredAssets.length, "le précache ne doit contenir aucun doublon");
assert.doesNotMatch(versionSource, /caches\.delete/u, "l'ancien cache doit rester disponible jusqu'à l'activation du nouveau service worker");
assert.doesNotMatch(swSource, /cache\.add\([^)]*\)\.catch/u, "un précache partiel ne doit jamais être accepté");

const versionedIndexAssets = [
  ...indexSource.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\?v=[^"']+)["'][^>]*>/giu),
]
  .map((match) => match[1])
  .filter((asset) => !/^(?:https?:)?\/\//iu.test(asset))
  .map((asset) => `./${asset.replace(/^\.\//u, "")}`);
const workerAssets = [...`${appSource}\n${estimateImportSource}`.matchAll(/GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/gu)]
  .map((match) => match[1]);
assert.ok(workerAssets.length >= 2, "les URLs principale et fallback du worker PDF doivent être déclarées");
assert.equal(new Set(workerAssets).size, 1, "tous les chemins du worker PDF doivent être identiques");

const exactRuntimeAssets = [...new Set([...versionedIndexAssets, ...workerAssets.map((asset) => `./${asset}`)])];
exactRuntimeAssets.forEach((asset) => {
  assert.ok(declaredAssets.includes(asset), `URL runtime non précachée exactement : ${asset}`);
  assert.equal(declaredAssets.includes(asset.split("?")[0]), false, `doublon non versionné interdit : ${asset.split("?")[0]}`);
});
getVersionedAssetQueries(`${indexSource}\n${offlineSource}\n${appSource}\n${estimateImportSource}\n${swSource}`).forEach((queryVersion) => {
  assert.equal(queryVersion, currentBuild.queryVersion, `query d'asset incohérente : ${queryVersion}`);
});

await vm.runInContext("precache()", context);
for (const asset of exactRuntimeAssets) {
  const absoluteUrl = absoluteCacheKey(asset);
  assert.ok(storedResponses.has(absoluteUrl), `asset absent du cache simulé : ${absoluteUrl}`);
  const handler = asset.includes("/vendor/") ? "cacheFirst" : "networkFirst";
  const response = await vm.runInContext(`${handler}(new Request(${JSON.stringify(absoluteUrl)}))`, context);
  assert.equal(response?.url, absoluteUrl, `l'asset doit rester disponible hors ligne : ${asset}`);
}

assert.ok(listeners.has("install") && listeners.has("activate") && listeners.has("fetch"), "les handlers PWA requis doivent être enregistrés");
console.log(`PWA CACHE VERSION CONTRACT OK (${currentBuild.appVersion}, ${exactRuntimeAssets.length} assets runtime exacts)`);
