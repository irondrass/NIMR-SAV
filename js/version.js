window.NIMR_BUILD = "v22.26";
window.NIMR_CACHE_NAME = "nimr-sav-v22.26-closed-archive-duration-fixes";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
