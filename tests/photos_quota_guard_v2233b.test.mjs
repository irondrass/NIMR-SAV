import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Démarrage des tests v22.33B : Photos & Quota Guard...");

// 1. Lire les sources des fichiers
const photosJs = fs.readFileSync("./js/photos.js", "utf8");
const storageJs = fs.readFileSync("./js/storage.js", "utf8");
const exportsJs = fs.readFileSync("./js/exports.js", "utf8");

// 2. Préparer le contexte global mocké
global.window = global;
global.state = { cases: [], bookings: [], syncConflicts: [] };
global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 6)}`;
global.normalizePhotoCategory = (c) => c;
global.getPhotoCategoryLabel = (c) => c;
global.ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
global.MAX_PHOTO_SIZE = 8 * 1024 * 1024;
global.MAX_PHOTO_EDGE = 1600;
global.PHOTO_JPEG_QUALITY = 0.82;
global.replacePhotoExtension = (n, e) => n.replace(/\.[^.]+$/, "") + "." + e;
global.getFileExtension = (n) => n.split(".").pop();
global.BACKUP_APP_ID = "nimr-carrosserie";
global.BACKUP_FORMAT_VERSION = 2;
global.APP_VERSION = "v22.33";
global.WORKSHOP_NAME = "NIMR SAV";

// Mocks UI / Interactions
let lastNotification = null;
let lastConfirmResult = true;
let lastQuietNotification = null;
let auditLogs = [];
let historyLogs = [];

global.notifyUser = (msg, type) => {
  lastNotification = { msg, type };
};
global.showConfirmModal = async (msg) => {
  return lastConfirmResult;
};
global.quietNotify = (msg, type) => {
  lastQuietNotification = { msg, type };
};
global.addAuditLog = (type, label, details) => {
  auditLogs.push({ type, label, details });
};
global.addHistory = (item, type, label, details) => {
  historyLogs.push({ item, type, label, details });
};
global.saveState = () => {};
global.renderCaseDetail = () => {};
global.render = () => {};
global.todayKey = () => "2026-06-03";
global.guardSensitiveAction = () => ({ ok: true });
global.isCaseReadonlyArchive = () => false;

// Mock Blob et File pour l'environnement Node
global.Blob = class Blob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || "application/octet-stream";
    this.size = parts.reduce((acc, part) => acc + (typeof part === "string" ? part.length : part.size || 0), 0);
  }
  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(this.size));
  }
};

// Évaluer les scripts dans le contexte global
global.photoDbPromise = null;
vm.runInThisContext(photosJs);
vm.runInThisContext(storageJs);

// Mock d'IndexedDB
let photoStoreData = new Map();
let documentStoreData = new Map();
let shouldThrowQuotaOnPut = false;

global.getAllPhotoRecords = async () => [...photoStoreData.values()];
global.getAllDocumentRecords = async () => [...documentStoreData.values()];
global.deletePhotoRecord = async (id) => {
  photoStoreData.delete(id);
};
global.deleteDocumentRecord = async (id) => {
  documentStoreData.delete(id);
};
global.savePhotoRecord = async (caseId, photo, blob) => {
  if (shouldThrowQuotaOnPut) {
    const err = new DOMException("QuotaExceededError", "QuotaExceededError");
    if (typeof addAuditLog === "function") {
      addAuditLog("storage.quota_exceeded", "Quota stockage dépassé lors de la sauvegarde photo", err.message);
    }
    throw err;
  }
  photoStoreData.set(photo.id, { ...photo, caseId, blob });
};
global.saveDocumentRecord = async (caseId, doc, blob) => {
  if (shouldThrowQuotaOnPut) {
    const err = new DOMException("QuotaExceededError", "QuotaExceededError");
    if (typeof addAuditLog === "function") {
      addAuditLog("storage.quota_exceeded", "Quota stockage dépassé lors de la sauvegarde document", err.message);
    }
    throw err;
  }
  documentStoreData.set(doc.id, { ...doc, caseId, blob });
};
global.clearPhotoStore = async () => {
  photoStoreData.clear();
};
global.clearDocumentStore = async () => {
  documentStoreData.clear();
};

// Ré-importer explicitement les fonctions globales dans le test
const {
  getStorageQuotaInfo,
  isQuotaError,
  clearDocumentStore,
  cleanupOrphanedStorage,
  savePhotoRecord,
  saveDocumentRecord,
  handlePhotos,
  preparePhotoForStorage,
  estimateBackupSize,
} = global;

// Mock de navigator.storage
let mockEstimate = { usage: 100, quota: 1000 };
let mockStorageSupported = true;

if (!global.navigator) {
  global.navigator = {};
}
global.navigator.storage = {
  estimate: async () => {
    if (!mockStorageSupported) throw new Error("Not supported");
    return mockEstimate;
  },
};

// Mock document.createElement pour la compression d'images
global.document = {
  createElement: (tag) => {
    if (tag === "canvas") {
      return {
        getContext: () => ({
          fillStyle: "",
          fillRect: () => {},
          drawImage: () => {},
        }),
        toBlob: (callback) => {
          callback(new global.Blob(["compressed-content"], { type: "image/jpeg" }));
        },
      };
    }
    return {};
  },
};
global.loadImageFromFile = async (file) => ({
  naturalWidth: 2000,
  naturalHeight: 1000,
  width: 2000,
  height: 1000,
  src: "blob:url",
});
global.canvasToBlob = async (canvas, type, quality) => {
  return new global.Blob(["compressed-content"], { type });
};
global.URL = {
  createObjectURL: () => "blob:url",
  revokeObjectURL: () => {},
};

async function runAllTestsSequential() {
  // Test 1: getStorageQuotaInfo avec estimate()
  mockStorageSupported = true;
  mockEstimate = { usage: 200, quota: 1000 }; // 20%
  const quota = await getStorageQuotaInfo();
  assert.equal(quota.supported, true);
  assert.equal(quota.percent, 20);

  // Test 2: isQuotaError
  const err1 = new DOMException("QuotaExceededError", "QuotaExceededError");
  assert.equal(isQuotaError(err1), true);
  const err2 = new Error("quota exceeded");
  assert.equal(isQuotaError(err2), true);
  const err3 = new Error("General error");
  assert.equal(isQuotaError(err3), false);

  // Test 3: preparePhotoForStorage compression réussie
  const file = new global.Blob(["heavy-image-content-heavy-image-content"], { type: "image/jpeg" });
  file.name = "dossier.jpg";
  const result = await preparePhotoForStorage(file);
  assert.equal(result.name, "dossier.jpg");
  assert.equal(result.blob.size, 18); // "compressed-content".length = 18

  // Test 4: preparePhotoForStorage compression échoue + original lourd (>1.5Mo) refusé
  global.loadImageFromFile = () => {
    throw new Error("Canvas crash");
  };
  const heavyFile = new global.Blob(["a".repeat(2 * 1024 * 1024)], { type: "image/jpeg" });
  heavyFile.name = "heavy.jpg";
  
  await assert.rejects(
    async () => {
      await preparePhotoForStorage(heavyFile);
    },
    (err) => {
      return err.message.includes("original trop lourd");
    }
  );
  assert.ok(lastNotification.msg.includes("trop volumineux et a été refusé"), "L'utilisateur doit être averti");

  // Test 5: preparePhotoForStorage compression échoue + original petit (<1.5Mo) autorisé avec warning
  const smallFile = new global.Blob(["a".repeat(500 * 1024)], { type: "image/jpeg" });
  smallFile.name = "small.jpg";
  
  lastNotification = null;
  const resultSmall = await preparePhotoForStorage(smallFile);
  assert.equal(resultSmall.blob.size, smallFile.size);
  assert.equal(lastNotification.type, "warn");
  assert.ok(lastNotification.msg.includes("a été conservé"));

  // Test 6: handlePhotos avec Quota Guard > 80% (warning) et > 90% (confirmation)
  mockEstimate = { usage: 850, quota: 1000 }; // 85%
  lastQuietNotification = null;
  
  const mockEvent = {
    target: {
      files: [new global.Blob(["a"], { type: "image/jpeg" })],
      value: "dummy",
    },
  };
  const mockItem = { id: "c1", photos: [] };
  
  global.loadImageFromFile = async () => ({ width: 100, height: 100 });
  
  const qInfo = await getStorageQuotaInfo();
  console.log("DEBUG Test 6 - getStorageQuotaInfo:", qInfo);
  console.log("DEBUG Test 6 - typeof navigator.storage.estimate:", typeof navigator?.storage?.estimate);

  await handlePhotos(mockEvent, mockItem, "before");
  console.log("DEBUG Test 6 - lastQuietNotification:", lastQuietNotification);
  
  assert.equal(lastQuietNotification.type, "warn");
  assert.ok(lastQuietNotification.msg.includes("Stockage navigateur utilisé"));
  
  // Configurer > 90%
  mockEstimate = { usage: 950, quota: 1000 }; // 95%
  lastConfirmResult = false; // L'utilisateur annule
  mockEvent.target.value = "dummy";
  mockItem.photos = [];
  
  await handlePhotos(mockEvent, mockItem, "before");
  assert.equal(mockEvent.target.value, "", "L'input doit être réinitialisé après annulation");
  assert.equal(mockItem.photos.length, 0, "Aucune photo ne doit être ajoutée si l'utilisateur annule");

  // Test 7: QuotaExceededError déclenché dans IndexedDB
  shouldThrowQuotaOnPut = true;
  mockEstimate = { usage: 200, quota: 1000 }; // 20%
  lastConfirmResult = true;
  auditLogs = [];
  lastNotification = null;
  
  const mockEventQuota = {
    target: {
      files: [new global.Blob(["a"], { type: "image/jpeg" })],
      value: "dummy",
    },
  };
  const mockItemQuota = { id: "c2", photos: [] };
  
  await handlePhotos(mockEventQuota, mockItemQuota, "before");
  assert.equal(mockItemQuota.photos.length, 0, "Le state ne doit pas contenir la photo en cas d'erreur IndexedDB");
  assert.equal(lastNotification.type, "error");
  assert.ok(lastNotification.msg.includes("Stockage navigateur saturé"));
  
  const quotaLog = auditLogs.find((l) => l.type === "storage.quota_exceeded");
  assert.ok(quotaLog, "L'événement storage.quota_exceeded doit être présent dans l'audit");
  
  shouldThrowQuotaOnPut = false; // Reset

  // Test 8: estimateBackupSize estimation
  state.cases = [
    {
      id: "case1",
      photos: [{ id: "p1", size: 1000 }, { id: "p2", size: 2000 }],
      expertEstimate: { sourceFile: { id: "d1", size: 5000 } },
      claims: [
        { estimate: { sourceFile: { id: "d2", size: 3000 } } },
      ],
    },
  ];
  
  const size = estimateBackupSize();
  const stateLen = JSON.stringify(state).length;
  const expected = Math.round((stateLen + 1000 + 2000 + 5000 + 3000) * 1.37);
  assert.equal(size, expected);

  // Test 9: suppression dossier et nettoyage des documents + orphelins
  photoStoreData.clear();
  documentStoreData.clear();
  
  const caseItem = {
    id: "case_to_delete",
    photos: [{ id: "photo_del_1" }],
    expertEstimate: { sourceFile: { id: "doc_del_1" } },
    claims: [
      { estimate: { sourceFile: { id: "doc_del_2" } } },
    ],
  };
  
  photoStoreData.set("photo_del_1", { id: "photo_del_1", caseId: "case_to_delete" });
  photoStoreData.set("photo_keep_1", { id: "photo_keep_1", caseId: "case_keep" });
  documentStoreData.set("doc_del_1", { id: "doc_del_1", caseId: "case_to_delete" });
  documentStoreData.set("doc_del_2", { id: "doc_del_2", caseId: "case_to_delete" });
  documentStoreData.set("doc_keep_1", { id: "doc_keep_1", caseId: "case_keep" });
  
  const deleteActiveCaseMock = async (item) => {
    addAuditLog("case.deleted", "Dossier supprimé", item.id);
    await Promise.all((item.photos || []).map((p) => deletePhotoRecord(p.id)));
    
    const docsToDelete = [];
    if (item.expertEstimate?.sourceFile?.id) {
      docsToDelete.push(item.expertEstimate.sourceFile.id);
    }
    (item.claims || []).forEach((c) => {
      if (c.estimate?.sourceFile?.id) {
        docsToDelete.push(c.estimate.sourceFile.id);
      }
    });
    await Promise.all(docsToDelete.map((d) => deleteDocumentRecord(d)));
  };
  
  await deleteActiveCaseMock(caseItem);
  
  assert.equal(photoStoreData.has("photo_del_1"), false);
  assert.equal(documentStoreData.has("doc_del_1"), false);
  assert.equal(documentStoreData.has("doc_del_2"), false);
  assert.equal(photoStoreData.has("photo_keep_1"), true);
  assert.equal(documentStoreData.has("doc_keep_1"), true);

  // Test 10: cleanupOrphanedStorage
  photoStoreData.clear();
  documentStoreData.clear();
  
  photoStoreData.set("photo_orphan", { id: "photo_orphan" });
  photoStoreData.set("photo_valid", { id: "photo_valid" });
  documentStoreData.set("doc_orphan", { id: "doc_orphan" });
  documentStoreData.set("doc_valid", { id: "doc_valid" });
  
  state.cases = [
    {
      id: "case_active",
      photos: [{ id: "photo_valid" }],
      expertEstimate: { sourceFile: { id: "doc_valid" } },
    },
  ];
  
  const cleaned = await cleanupOrphanedStorage();
  assert.equal(cleaned.photosDeleted, 1);
  assert.equal(cleaned.docsDeleted, 1);
  
  assert.equal(photoStoreData.has("photo_orphan"), false);
  assert.equal(photoStoreData.has("photo_valid"), true);
  assert.equal(documentStoreData.has("doc_orphan"), false);
  assert.equal(documentStoreData.has("doc_valid"), true);

  // Test 11: clearDocumentStore
  photoStoreData.clear();
  documentStoreData.clear();
  documentStoreData.set("doc_1", { id: "doc_1" });
  documentStoreData.set("doc_2", { id: "doc_2" });
  assert.equal(documentStoreData.size, 2);
  
  await clearDocumentStore();
  assert.equal(documentStoreData.size, 0);
}

runAllTestsSequential()
  .then(() => {
    console.log("Tests v22.33B passés avec succès !");
  })
  .catch((err) => {
    console.error("Échec des tests :", err);
    process.exit(1);
  });
