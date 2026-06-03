window.APP_VERSION = "v22.35";
window.NIMR_BUILD = "v22.35";
window.NIMR_CACHE_NAME = "nimr-sav-v22.35-production-audit-hardening";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
