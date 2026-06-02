window.NIMR_BUILD = "v22.29";
window.NIMR_CACHE_NAME = "nimr-sav-v22.29-planning-business-task-aggregation";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
