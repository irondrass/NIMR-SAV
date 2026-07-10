window.APP_VERSION = "v23.2.7";
window.NIMR_BUILD = "v23.2.7-simplified-startup";
window.NIMR_CACHE_NAME = "nimr-sav-v23.2.7-simplified-startup";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
