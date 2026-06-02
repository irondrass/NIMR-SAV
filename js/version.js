window.NIMR_BUILD = "v22.27";
window.NIMR_CACHE_NAME = "nimr-sav-v22.27-technician-pause-remainder-single-card";

if ("caches" in window) {
  caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => (key.startsWith("nimr-carrosserie-") || key.startsWith("nimr-sav-")) && key !== window.NIMR_CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).catch(() => null);
}
