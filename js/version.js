window.APP_VERSION = "v23.0.4";
window.NIMR_BUILD = "v23.0.4";
window.NIMR_CACHE_NAME = "nimr-sav-v23.0.4-sync-conflict-resolution";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
