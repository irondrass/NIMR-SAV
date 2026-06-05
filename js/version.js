window.APP_VERSION = "v23.1.3";
window.NIMR_BUILD = "v23.1.3";
window.NIMR_CACHE_NAME = "nimr-sav-v23.1.3-reception-create-case-local-pin-fix";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
