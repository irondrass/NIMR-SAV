function getWorkflowValues(item) {
  const hasAppointment = Boolean(item.appointment);
  const hasReceivedVehicle = Boolean(item.flags.received);
  return {
    created: true,
    photos: item.photos.length > 0,
    expert: Boolean(item.expertName || item.expertPhone || item.expertEmail),
    expertApproved: Boolean(item.flags.expertApproved),
    expertEstimate: Boolean(item.expertEstimate?.confirmed && expertEstimateTotalHours(item) > 0),
    clientApproved: Boolean(item.flags.clientApproved),
    appointment: hasAppointment,
    // Une étape intermédiaire déjà franchie doit rester cochée quand l'étape suivante est validée.
    // Avant ce correctif, "En attente réception" redevenait grisée dès que "Véhicule reçu" était coché.
    vehiclePending: hasAppointment || hasReceivedVehicle,
    received: hasReceivedVehicle,
    assigned: state.bookings.some((booking) => booking.caseId === item.id),
    workStarted: Boolean(item.flags.workStarted),
    workCompleted: Boolean(item.flags.workCompleted),
    qualityApproved: Boolean(item.flags.qualityApproved),
    delivered: Boolean(item.flags.delivered),
    invoiced: Boolean(item.flags.invoiced),
  };
}

function isQualityChecklistComplete(item) {
  return DEFAULT_QUALITY_CHECKS.every((label) => Boolean(item.qualityChecklist[label]));
}

async function handlePhotos(event, item, category = "before") {
  category = normalizePhotoCategory(category);
  const files = [...event.target.files].slice(0, 8);
  if (!files.length) return;

  const quota = await getStorageQuotaInfo();
  if (quota.supported) {
    if (quota.percent > 90) {
      const confirmed = await showConfirmModal(
        `Le stockage de votre navigateur est presque saturé (${quota.percent.toFixed(1)}% utilisé). Continuer d'ajouter des photos ?`
      );
      if (!confirmed) {
        event.target.value = "";
        return;
      }
    } else if (quota.percent > 80) {
      quietNotify(`Stockage navigateur utilisé à ${quota.percent.toFixed(1)}%. Pensez à exporter vos données.`, "warn");
    }
  }

  const loaded = [];
  let rejected = 0;
  let quotaExceeded = false;
  for (const file of files) {
    try {
      const prepared = await preparePhotoForStorage(file);
      const photo = {
        id: uid("photo"),
        name: prepared.name,
        type: prepared.blob.type || "image/jpeg",
        size: prepared.blob.size,
        category,
        createdAt: new Date().toISOString(),
      };
      await savePhotoRecord(item.id, photo, prepared.blob);
      loaded.push(photo);
    } catch (error) {
      rejected += 1;
      console.warn("Photo ignorée", file?.name, error);
      if (isQuotaError(error)) {
        quotaExceeded = true;
      }
    }
  }
  if (quotaExceeded) {
    notifyUser("Stockage navigateur saturé. Supprimez des photos anciennes ou exportez une sauvegarde.", "error");
  } else if (rejected) {
    notifyUser("Photo trop volumineuse ou format non supporté.", "error");
  }
  if (loaded.length) {
    item.photos.push(...loaded);
    addHistory(item, "photos.added", `${loaded.length} photo${loaded.length > 1 ? "s" : ""} ajoutée${loaded.length > 1 ? "s" : ""}`, getPhotoCategoryLabel(category));
  }
  saveState();
  renderCaseDetail();
  event.target.value = "";
}

async function preparePhotoForStorage(file) {
  if (!file || !ALLOWED_PHOTO_TYPES.includes(file.type)) {
    throw new Error("Format photo non supporté");
  }
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error("Photo trop volumineuse");
  }
  if (!file.type.startsWith("image/") || !("createElement" in document)) {
    return { blob: file, name: file.name || "photo" };
  }
  try {
    const image = await loadImageFromFile(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    if (scale >= 1 && file.type === "image/webp") return { blob: file, name: file.name || "photo" };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", PHOTO_JPEG_QUALITY);
    URL.revokeObjectURL(image.src);
    return { blob: blob || file, name: replacePhotoExtension(file.name || "photo", blob ? "jpg" : getFileExtension(file.name) || "jpg") };
  } catch (error) {
    console.warn("Compression photo impossible", error);
    if (file.size > 1.5 * 1024 * 1024) {
      notifyUser(`La compression de la photo a échoué. Le fichier original de ${(file.size / (1024 * 1024)).toFixed(1)} Mo est trop volumineux et a été refusé.`, "error");
      throw new Error(`Compression échouée et fichier original trop lourd: ${file.name}`);
    } else {
      notifyUser(`La compression de la photo a échoué. Le fichier original de ${(file.size / 1024).toFixed(0)} Ko a été conservé.`, "warn");
      return { blob: file, name: file.name || "photo" };
    }
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function replacePhotoExtension(name, extension) {
  const clean = String(name || "photo").replace(/\.[^.]+$/, "");
  return `${clean}.${extension}`;
}

async function hydratePhotoImages(container, item) {
  await Promise.all(
    item.photos.map(async (photo) => {
      const img = container.querySelector(`[data-photo-img="${photo.id}"]`);
      if (!img) return;
      let record = null;
      try {
        record = await getPhotoRecord(photo.id);
      } catch (error) {
        console.error("Lecture photo IndexedDB impossible", error);
      }
      if (!record?.blob) {
        img.removeAttribute("src");
        img.closest(".photo-tile")?.classList.add("missing-photo");
        return;
      }
      revokePhotoUrl(photo.id);
      const url = URL.createObjectURL(record.blob);
      photoObjectUrls.set(photo.id, url);
      img.onerror = () => {
        revokePhotoUrl(photo.id);
        img.removeAttribute("src");
        img.closest(".photo-tile")?.classList.add("missing-photo");
      };
      img.src = url;
    }),
  );
}

function openPhotoDb() {
  if (photoDbPromise) return photoDbPromise;
  photoDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const store = db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
        store.createIndex("caseId", "caseId", { unique: false });
      }
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        const store = db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
        store.createIndex("caseId", "caseId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE) || !db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.close();
        photoDbPromise = null;
        reject(new Error("IndexedDB: stockage local incomplet. Rechargez l'application."));
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      photoDbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      photoDbPromise = null;
      reject(new Error("IndexedDB: ouverture bloquée par un autre onglet."));
    };
  });
  return photoDbPromise;
}

async function savePhotoRecord(caseId, photo, blob) {
  try {
    const db = await openPhotoDb();
    return await idbRequest(
      db
        .transaction(PHOTO_STORE, "readwrite")
        .objectStore(PHOTO_STORE)
        .put({ ...photo, caseId, blob }),
    );
  } catch (error) {
    if (isQuotaError(error)) {
      if (typeof addAuditLog === "function") {
        addAuditLog("storage.quota_exceeded", "Quota stockage dépassé lors de la sauvegarde photo", error.message || error.name);
      }
    }
    throw error;
  }
}

async function getPhotoRecord(id) {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).get(id));
}

async function saveDocumentRecord(caseId, documentMeta, blob) {
  try {
    const db = await openPhotoDb();
    return await idbRequest(
      db
        .transaction(DOCUMENT_STORE, "readwrite")
        .objectStore(DOCUMENT_STORE)
        .put({ ...documentMeta, caseId, blob }),
    );
  } catch (error) {
    if (isQuotaError(error)) {
      if (typeof addAuditLog === "function") {
        addAuditLog("storage.quota_exceeded", "Quota stockage dépassé lors de la sauvegarde document", error.message || error.name);
      }
    }
    throw error;
  }
}

async function getDocumentRecord(id) {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get(id));
}

async function deleteDocumentRecord(id) {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(DOCUMENT_STORE, "readwrite").objectStore(DOCUMENT_STORE).delete(id));
}

async function deletePhotoRecord(id) {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(PHOTO_STORE, "readwrite").objectStore(PHOTO_STORE).delete(id));
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function revokePhotoUrl(photoId) {
  const url = photoObjectUrls.get(photoId);
  if (!url) return;
  URL.revokeObjectURL(url);
  photoObjectUrls.delete(photoId);
}

function revokePhotoUrlsForCase(item) {
  (item?.photos || []).forEach((photo) => revokePhotoUrl(photo.id));
}

async function migrateLegacyPhotos() {
  let migrated = false;
  for (const item of state.cases) {
    for (const photo of item.photos) {
      const legacyDataUrl = legacyPhotoPayloads.get(photo.id);
      if (!legacyDataUrl) continue;
      const blob = dataUrlToBlob(legacyDataUrl);
      await savePhotoRecord(item.id, photo, blob);
      legacyPhotoPayloads.delete(photo.id);
      migrated = true;
    }
  }
  if (migrated) saveState();
}

function dataUrlToBlob(dataUrl) {
  const [header, content] = dataUrl.split(",");
  const type = /data:(.*?);base64/.exec(header)?.[1] || "image/jpeg";
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function getAllPhotoRecords() {
  const db = await openPhotoDb();
  const store = db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE);
  if ("getAll" in store) return idbRequest(store.getAll());
  return new Promise((resolve, reject) => {
    const records = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      records.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function clearPhotoStore() {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(PHOTO_STORE, "readwrite").objectStore(PHOTO_STORE).clear());
}

function findCaseIdForPhoto(photoId) {
  return state.cases.find((item) => item.photos.some((photo) => photo.id === photoId))?.id || null;
}


async function getAllDocumentRecords() {
  const db = await openPhotoDb();
  const store = db.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE);
  if (store.getAll) return idbRequest(store.getAll());
  return new Promise((resolve, reject) => {
    const documents = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(documents);
        return;
      }
      documents.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function restoreDocumentRecords(documents = []) {
  let count = 0;
  for (const savedDocument of documents) {
    if (!savedDocument?.dataUrl) continue;
    const id = savedDocument.id || uid("doc");
    const caseId = savedDocument.caseId;
    const documentMeta = {
      id,
      name: savedDocument.name || "document",
      type: savedDocument.type || "application/octet-stream",
      size: Number(savedDocument.size || 0),
      category: savedDocument.category || "estimate_original",
      createdAt: savedDocument.createdAt || new Date().toISOString(),
    };
    await saveDocumentRecord(caseId, documentMeta, dataUrlToBlob(savedDocument.dataUrl));
    count += 1;
  }
  return count;
}

async function restorePhotoRecords(photos) {
  if (!Array.isArray(photos) || !photos.length) return 0;
  let restored = 0;
  for (const savedPhoto of photos) {
    if (!savedPhoto?.id || !savedPhoto?.dataUrl) continue;
    const caseId = savedPhoto.caseId || findCaseIdForPhoto(savedPhoto.id);
    if (!caseId) continue;
    const photo = normalizePhotoMeta(savedPhoto);
    await savePhotoRecord(caseId, photo, dataUrlToBlob(savedPhoto.dataUrl));
    restored += 1;
  }
  return restored;
}

async function getStorageQuotaInfo() {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;
      return { usage, quota, percent, supported: true };
    } catch (error) {
      console.warn("Storage quota estimation failed", error);
    }
  }
  return { usage: 0, quota: 0, percent: 0, supported: false };
}

function isQuotaError(error) {
  if (!error) return false;
  return error.name === "QuotaExceededError" || 
         error.name === "NS_ERROR_DOM_QUOTA_REACHED" || 
         String(error.message || "").includes("QuotaExceededError") ||
         String(error.message || "").includes("quota");
}

async function clearDocumentStore() {
  const db = await openPhotoDb();
  return idbRequest(db.transaction(DOCUMENT_STORE, "readwrite").objectStore(DOCUMENT_STORE).clear());
}

async function cleanupOrphanedStorage() {
  try {
    const validPhotoIds = new Set();
    const validDocIds = new Set();
    
    if (typeof state !== "undefined" && Array.isArray(state.cases)) {
      state.cases.forEach((item) => {
        if (Array.isArray(item.photos)) {
          item.photos.forEach((photo) => {
            if (photo.id) validPhotoIds.add(photo.id);
          });
        }
        if (item.expertEstimate?.sourceFile?.id) {
          validDocIds.add(item.expertEstimate.sourceFile.id);
        }
        if (Array.isArray(item.claims)) {
          item.claims.forEach((claim) => {
            if (claim.estimate?.sourceFile?.id) {
              validDocIds.add(claim.estimate.sourceFile.id);
            }
          });
        }
      });
    }

    const allPhotos = await getAllPhotoRecords().catch(() => []);
    let photosDeleted = 0;
    for (const photo of allPhotos) {
      if (photo.id && !validPhotoIds.has(photo.id)) {
        await deletePhotoRecord(photo.id).catch(() => null);
        photosDeleted += 1;
      }
    }

    const allDocs = await getAllDocumentRecords().catch(() => []);
    let docsDeleted = 0;
    for (const doc of allDocs) {
      if (doc.id && !validDocIds.has(doc.id)) {
        await deleteDocumentRecord(doc.id).catch(() => null);
        docsDeleted += 1;
      }
    }

    if (photosDeleted > 0 || docsDeleted > 0) {
      console.log(`[Storage Cleanup] Purged ${photosDeleted} orphaned photos and ${docsDeleted} orphaned documents.`);
    }
    return { photosDeleted, docsDeleted };
  } catch (error) {
    console.warn("Storage cleanup failed", error);
    return { photosDeleted: 0, docsDeleted: 0 };
  }
}

window.getStorageQuotaInfo = getStorageQuotaInfo;
window.isQuotaError = isQuotaError;
window.clearDocumentStore = clearDocumentStore;
window.cleanupOrphanedStorage = cleanupOrphanedStorage;


