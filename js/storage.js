const PLAIN_JSON_EXPORT_CONFIRMATION = "EXPORT NON CHIFFRE";
const RESTORE_BACKUP_CONFIRMATION = "RESTAURER";
const LARGE_STATE_DB_NAME = "nimr-sav-large-state";
const LARGE_STATE_DB_VERSION = 3;
const LARGE_STATE_STORE = "snapshots";
const LARGE_STATE_KEY = "latest";
const DURABLE_OUTBOX_STORE = "outbox";
const SYNC_METADATA_STORE = "sync_metadata";
const ENTITY_STATE_META_STORE = "state_meta";
const ENTITY_CASE_STORE = "cases";
const ENTITY_BOOKING_STORE = "bookings";
const ENTITY_AUDIT_STORE = "audit_log";
const ENTITY_STATE_FORMAT = "nimr-sav-entity-state";
const ENTITY_STATE_FORMAT_VERSION = 1;
const DURABLE_OUTBOX_MIRROR_KEY = "nimr-sav-outbox-mirror:v2";
const DURABLE_OUTBOX_FALLBACK_KEY = "nimr-sav-outbox-fallback:v2";
const DURABLE_OUTBOX_ACTIVE_SYNC_STATUSES = new Set(["pending", "processing", "settling", "failed", "conflicted", "conflict"]);
const DURABLE_OUTBOX_SENDABLE_SYNC_STATUSES = new Set(["pending", "processing", "failed"]);
const LARGE_STATE_CASE_THRESHOLD = 250;
const LARGE_STATE_BYTE_THRESHOLD = 2 * 1024 * 1024;

function openLargeStateDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponible."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LARGE_STATE_DB_NAME, LARGE_STATE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LARGE_STATE_STORE)) {
        database.createObjectStore(LARGE_STATE_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DURABLE_OUTBOX_STORE)) {
        const outbox = database.createObjectStore(DURABLE_OUTBOX_STORE, { keyPath: "operationId" });
        outbox.createIndex("syncStatus", "syncStatus", { unique: false });
        outbox.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(SYNC_METADATA_STORE)) {
        database.createObjectStore(SYNC_METADATA_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(ENTITY_STATE_META_STORE)) {
        database.createObjectStore(ENTITY_STATE_META_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ENTITY_CASE_STORE)) {
        database.createObjectStore(ENTITY_CASE_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ENTITY_BOOKING_STORE)) {
        database.createObjectStore(ENTITY_BOOKING_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ENTITY_AUDIT_STORE)) {
        database.createObjectStore(ENTITY_AUDIT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Ouverture IndexedDB impossible."));
  });
}

function isIndexedDbRequest(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof IDBRequest !== "undefined" && value instanceof IDBRequest) return true;
  return Object.prototype.toString.call(value) === "[object IDBRequest]";
}

function resolveIndexedDbOperationResult(operationResult) {
  if (typeof operationResult === "function") return operationResult();
  return isIndexedDbRequest(operationResult) ? operationResult.result : operationResult;
}

function runIndexedDbStoresTransaction(storeNames, mode, operation) {
  return openLargeStateDatabase().then((database) => new Promise((resolve, reject) => {
    const names = [...new Set(Array.isArray(storeNames) ? storeNames : [storeNames])];
    const transaction = database.transaction(names, mode);
    const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
    let operationResult;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    try {
      operationResult = operation(stores, transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction may already be inactive */ }
      rejectOnce(error);
      return;
    }
    transaction.oncomplete = () => {
      if (settled) return;
      let result;
      try {
        result = resolveIndexedDbOperationResult(operationResult);
      } catch (error) {
        rejectOnce(error);
        return;
      }
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      rejectOnce(transaction.error || new Error("Transaction IndexedDB impossible."));
    };
    transaction.onabort = transaction.onerror;
  }));
}

function runIndexedDbTransaction(storeName, mode, operation) {
  return runIndexedDbStoresTransaction([storeName], mode, (stores, transaction) => operation(stores[storeName], transaction));
}

function runLargeStateTransaction(mode, operation) {
  return runIndexedDbTransaction(LARGE_STATE_STORE, mode, operation);
}

function getEntityStateRoot(candidate) {
  const root = {};
  Object.keys(candidate || {}).forEach((key) => {
    if (["cases", "bookings", "auditLog"].includes(key)) return;
    root[key] = candidate[key];
  });
  return root;
}

function estimateStateJsonBytes(candidate = state) {
  try {
    const encoder = new TextEncoder();
    let bytes = encoder.encode(JSON.stringify(getEntityStateRoot(candidate || {}))).byteLength;
    [candidate?.cases, candidate?.bookings, candidate?.auditLog].forEach((collection) => {
      (Array.isArray(collection) ? collection : []).forEach((entry) => {
        bytes += encoder.encode(JSON.stringify(entry)).byteLength;
      });
    });
    return bytes;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function shouldPersistStateInIndexedDb(candidate = state) {
  return typeof indexedDB !== "undefined" && Boolean(candidate && typeof candidate === "object");
}

function hashEntityPersistenceValue(value) {
  const input = JSON.stringify(value ?? null);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getEntityPersistenceKey(entity, prefix, index = 0) {
  const id = String(entity?.id ?? "").trim();
  return id || `${prefix}:fallback:${hashEntityPersistenceValue(entity)}:${index}`;
}

let entityPersistenceTail = Promise.resolve();
let entityPersistenceTracker = {
  initialized: false,
  mutationVersion: 0,
  candidateSource: null,
  casesSource: null,
  bookingsSource: null,
  auditSource: null,
  casesLength: -1,
  bookingsLength: -1,
  auditLength: -1,
  cases: new Map(),
  bookings: new Map(),
  audit: new Map(),
  auditObjectKeys: new WeakMap(),
};
let entityPersistenceMutationVersion = 0;
const dirtyEntityCases = new Map();
const deletedEntityCaseIds = new Map();
const dirtyEntityBookings = new Map();
const deletedEntityBookingIds = new Map();
const dirtyEntityAuditEntries = new Map();
let entityAuditStructureGeneration = 0;
let entityStateFullReplacementGeneration = 0;
let lastEntityPersistenceStats = null;
let cloudEntityMutationVersion = 0;
const cloudCaseMutations = new Map();
const cloudBookingMutations = new Map();
const cloudAuditMutations = new Map();
let cloudWorkshopSettingsMutation = null;
let durableWorkshopSettingsFingerprint = "";
const observedGranularEntityMetadata = new Map();
const durableOutboxEntityBaseVersions = new Map();
const OBSERVED_GRANULAR_METADATA_PREFIX = "granular-observed:";

function cloneGranularSyncValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch { /* JSON-safe fallback below */ }
  }
  return JSON.parse(JSON.stringify(value));
}

function nextCloudEntityMutationGeneration() {
  cloudEntityMutationVersion += 1;
  return cloudEntityMutationVersion;
}

function markCloudEntityMutation(collection, entityId, action, value = null) {
  const id = String(entityId || "").trim();
  if (!id) return null;
  const marker = {
    entityId: id,
    action,
    value,
    generation: nextCloudEntityMutationGeneration(),
    updatedAt: new Date().toISOString(),
  };
  collection.set(id, marker);
  return marker;
}

function nextEntityPersistenceMutationGeneration() {
  entityPersistenceMutationVersion += 1;
  return entityPersistenceMutationVersion;
}

function markEntityCaseDirty(caseOrId, options = {}) {
  const caseItem = caseOrId && typeof caseOrId === "object" ? caseOrId : null;
  const id = String(caseItem?.id ?? caseOrId ?? "").trim();
  if (id) {
    deletedEntityCaseIds.delete(id);
    dirtyEntityCases.set(id, { value: caseItem, generation: nextEntityPersistenceMutationGeneration() });
    if (!options.skipCloud) markCloudEntityMutation(cloudCaseMutations, id, "upsert", caseItem);
  }
}

function markEntityCaseDeleted(caseOrId, options = {}) {
  const caseItem = caseOrId && typeof caseOrId === "object" ? caseOrId : null;
  const id = String(caseItem?.id ?? caseOrId ?? "").trim();
  if (id) {
    dirtyEntityCases.delete(id);
    deletedEntityCaseIds.set(id, nextEntityPersistenceMutationGeneration());
    if (!options.skipCloud) markCloudEntityMutation(cloudCaseMutations, id, "delete", caseItem);
  }
}

function markEntityBookingDirty(bookingOrId, options = {}) {
  const booking = bookingOrId && typeof bookingOrId === "object" ? bookingOrId : null;
  const id = String(booking?.id ?? bookingOrId ?? "").trim();
  if (id) {
    deletedEntityBookingIds.delete(id);
    dirtyEntityBookings.set(id, { value: booking, generation: nextEntityPersistenceMutationGeneration() });
    if (!options.skipCloud) markCloudEntityMutation(cloudBookingMutations, id, "upsert", booking);
  }
}

function markEntityBookingDeleted(bookingId, options = {}) {
  const id = String(bookingId || "").trim();
  if (id) {
    dirtyEntityBookings.delete(id);
    deletedEntityBookingIds.set(id, nextEntityPersistenceMutationGeneration());
    if (!options.skipCloud) markCloudEntityMutation(cloudBookingMutations, id, "delete");
  }
}

function markEntityAuditEntryDirty(entry, options = {}) {
  const generation = nextEntityPersistenceMutationGeneration();
  if (entry && typeof entry === "object") dirtyEntityAuditEntries.set(entry, generation);
  entityAuditStructureGeneration = generation;
  if (!options.skipCloud && entry && typeof entry === "object") {
    const id = String(entry.id || `audit:${entry.type || "event"}:${entry.at || generation}`);
    markCloudEntityMutation(cloudAuditMutations, id, "append", entry);
  }
}

function markWorkshopSettingsCloudDirty(settingsPayload) {
  if (!settingsPayload || typeof settingsPayload !== "object") return null;
  const snapshot = cloneGranularSyncValue(settingsPayload);
  const fingerprintValue = cloneGranularSyncValue(snapshot);
  delete fingerprintValue.exportedAt;
  if (fingerprintValue.workHoursSync) {
    delete fingerprintValue.workHoursSync.acknowledgedAt;
    delete fingerprintValue.workHoursSync.pending;
  }
  const fingerprint = hashEntityPersistenceValue(fingerprintValue);
  if (fingerprint === durableWorkshopSettingsFingerprint) return null;
  cloudWorkshopSettingsMutation = {
    entityId: "workshop_settings",
    action: "upsert",
    value: snapshot,
    fingerprint,
    generation: nextCloudEntityMutationGeneration(),
    updatedAt: new Date().toISOString(),
  };
  return cloudWorkshopSettingsMutation;
}

function findCloudMutationValue(candidate, entityType, marker) {
  if (marker.action === "delete") return null;
  if (marker.value && typeof marker.value === "object") return marker.value;
  const collection = entityType === "case" ? candidate?.cases : candidate?.bookings;
  return (Array.isArray(collection) ? collection : []).find((entry) => String(entry?.id || "") === marker.entityId) || null;
}

function getObservedGranularMetadataKey(workshopId, entityType, entityId) {
  return `${OBSERVED_GRANULAR_METADATA_PREFIX}${String(workshopId || getOutboxWorkshopId())}:${String(entityType || "")}:${String(entityId || "")}`;
}

function normalizeObservedGranularMetadata(value = {}) {
  const serverVersion = normalizeOutboxExpectedVersion(value.serverVersion ?? value.entityVersion);
  return {
    key: String(value.key || getObservedGranularMetadataKey(value.workshopId, value.entityType, value.entityId)),
    workshopId: String(value.workshopId || getOutboxWorkshopId()),
    entityType: String(value.entityType || ""),
    entityId: String(value.entityId || ""),
    serverVersion,
    lastOperationId: String(value.lastOperationId || value.last_operation_id || ""),
    deleted: Boolean(value.deleted ?? value.deletedAt ?? value.deleted_at),
    updatedAt: value.updatedAt || value.updated_at || new Date().toISOString(),
  };
}

function selectMonotonicObservedGranularMetadata(currentValue, incomingValue) {
  const incoming = normalizeObservedGranularMetadata(incomingValue);
  const current = currentValue ? normalizeObservedGranularMetadata(currentValue) : null;
  if (!current || current.key !== incoming.key) return incoming;
  const currentVersion = normalizeOutboxExpectedVersion(current.serverVersion);
  const incomingVersion = normalizeOutboxExpectedVersion(incoming.serverVersion);
  if (currentVersion !== null && (incomingVersion === null || incomingVersion < currentVersion)) return current;
  if (currentVersion === incomingVersion && currentVersion !== null) {
    const operationContradiction = Boolean(
      current.lastOperationId
      && incoming.lastOperationId
      && current.lastOperationId !== incoming.lastOperationId
    );
    if (operationContradiction || current.deleted !== incoming.deleted) return current;
  }
  return incoming;
}

function getObservedGranularEntityMetadata(workshopId, entityType, entityId) {
  return observedGranularEntityMetadata.get(getObservedGranularMetadataKey(workshopId, entityType, entityId)) || null;
}

function getObservedGranularServerVersion(workshopId, entityType, entityId) {
  return getObservedGranularEntityMetadata(workshopId, entityType, entityId)?.serverVersion ?? null;
}

function isActiveDurableOutboxSyncStatus(status) {
  return DURABLE_OUTBOX_ACTIVE_SYNC_STATUSES.has(String(status || ""));
}

function isSendableDurableOutboxSyncStatus(status) {
  return DURABLE_OUTBOX_SENDABLE_SYNC_STATUSES.has(String(status || ""));
}

function getMutationBaseVersion(workshopId, entityType, entityId) {
  const key = [workshopId, entityType, entityId].map((value) => String(value || "")).join("|");
  if (!durableOutboxEntityBaseVersions.size && typeof readDurableOutboxMirror === "function") {
    readDurableOutboxMirror().forEach((entry) => {
      if (!isActiveDurableOutboxSyncStatus(entry.syncStatus || entry.status)) return;
      const entryKey = [entry.workshopId, entry.entityType, entry.entityId].map((value) => String(value || "")).join("|");
      if (!durableOutboxEntityBaseVersions.has(entryKey)) {
        durableOutboxEntityBaseVersions.set(entryKey, normalizeOutboxExpectedVersion(entry.baseVersion ?? entry.expectedVersion));
      }
    });
  }
  if (durableOutboxEntityBaseVersions.has(key)) return durableOutboxEntityBaseVersions.get(key);
  return getObservedGranularServerVersion(workshopId, entityType, entityId);
}

function captureEntityMutationBatch(candidate = state, options = {}) {
  if (options.workshopSettings) markWorkshopSettingsCloudDirty(options.workshopSettings);
  const captured = [];
  const captureMap = (entityType, collection) => {
    collection.forEach((marker) => {
      const value = findCloudMutationValue(candidate, entityType, marker);
      if (marker.action !== "delete" && !value) return;
      const entityVersion = null;
      const baseVersion = getMutationBaseVersion(
        options.workshopId || getOutboxWorkshopId(),
        entityType,
        marker.entityId,
      );
      const deletePayload = entityType === "case" && marker.value
        ? {
          projectionLocalId: typeof caseSyncLocalId === "function"
            ? caseSyncLocalId(marker.value)
            : marker.entityId,
        }
        : {};
      captured.push({
        entityType,
        entityId: marker.entityId,
        action: marker.action,
        entityVersion,
        baseVersion,
        expectedVersion: baseVersion,
        updatedAt: value?.updatedAt || marker.updatedAt,
        generation: marker.generation,
        payload: marker.action === "delete" ? deletePayload : { entity: cloneGranularSyncValue(value) },
      });
    });
  };
  captureMap("case", cloudCaseMutations);
  captureMap("booking", cloudBookingMutations);
  cloudAuditMutations.forEach((marker) => {
    captured.push({
      entityType: "audit",
      entityId: marker.entityId,
      action: "append",
      entityVersion: marker.generation,
      expectedVersion: null,
      updatedAt: marker.value?.at || marker.updatedAt,
      generation: marker.generation,
      payload: { entity: cloneGranularSyncValue(marker.value) },
    });
  });
  if (cloudWorkshopSettingsMutation) {
    captured.push({
      entityType: "workshop_settings",
      entityId: "workshop_settings",
      action: "upsert",
      entityVersion: null,
      baseVersion: getMutationBaseVersion(
        options.workshopId || getOutboxWorkshopId(),
        "workshop_settings",
        "workshop_settings",
      ),
      expectedVersion: getMutationBaseVersion(
        options.workshopId || getOutboxWorkshopId(),
        "workshop_settings",
        "workshop_settings",
      ),
      updatedAt: cloudWorkshopSettingsMutation.updatedAt,
      generation: cloudWorkshopSettingsMutation.generation,
      settingsFingerprint: cloudWorkshopSettingsMutation.fingerprint,
      payload: { entity: cloneGranularSyncValue(cloudWorkshopSettingsMutation.value) },
    });
  }
  return captured.sort((left, right) => {
    const typeOrder = { case: 1, booking: 2, audit: 3, workshop_settings: 4 };
    return (typeOrder[left.entityType] || 99) - (typeOrder[right.entityType] || 99)
      || String(left.entityId).localeCompare(String(right.entityId));
  });
}

function buildDurableOperationFromEntityMutation(mutation, options = {}) {
  const workshopId = String(options.workshopId || getOutboxWorkshopId());
  const operationId = makeOutboxIdentifier("operation");
  const baseVersion = Object.hasOwn(mutation, "baseVersion") ? mutation.baseVersion : mutation.expectedVersion;
  return normalizeDurableOutboxOperation({
    operationId,
    idempotencyKey: `${workshopId}:${operationId}`,
    workshopId,
    userId: options.userId || getOutboxUserId(),
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    action: mutation.action,
    entityVersion: mutation.entityVersion,
    baseVersion,
    expectedVersion: baseVersion,
    payload: mutation.payload,
    updatedAt: mutation.updatedAt,
    syncStatus: "pending",
    description: `${mutation.entityType} ${mutation.action} à synchroniser`,
  });
}

function acknowledgeEntityMutationBatch(batch = []) {
  const acknowledgeMap = (collection, descriptor) => {
    const current = collection.get(descriptor.entityId);
    if (current?.generation === descriptor.generation) collection.delete(descriptor.entityId);
  };
  batch.forEach((descriptor) => {
    if (descriptor.entityType === "case") acknowledgeMap(cloudCaseMutations, descriptor);
    if (descriptor.entityType === "booking") acknowledgeMap(cloudBookingMutations, descriptor);
    if (descriptor.entityType === "audit") acknowledgeMap(cloudAuditMutations, descriptor);
    if (
      descriptor.entityType === "workshop_settings"
      && cloudWorkshopSettingsMutation?.generation === descriptor.generation
    ) {
      durableWorkshopSettingsFingerprint = descriptor.settingsFingerprint || durableWorkshopSettingsFingerprint;
      cloudWorkshopSettingsMutation = null;
    }
  });
}

function markEntityStateFullReplacement() {
  entityStateFullReplacementGeneration = nextEntityPersistenceMutationGeneration();
}

function getEntityPersistenceStats() {
  return lastEntityPersistenceStats ? { ...lastEntityPersistenceStats } : null;
}

function makeEntityWrapper(id, order, value) {
  return { id, order, value };
}

function buildFullEntityCollection(collection, prefix, objectKeyMap = null) {
  const used = new Set();
  const records = [];
  const tracker = new Map();
  collection.forEach((value, order) => {
    let key = objectKeyMap?.get(value) || getEntityPersistenceKey(value, prefix, order);
    while (used.has(key)) key = `${key}:duplicate:${order}`;
    used.add(key);
    if (objectKeyMap && value && typeof value === "object") objectKeyMap.set(value, key);
    records.push(makeEntityWrapper(key, order, value));
    tracker.set(key, { order, valueRef: value });
  });
  return { records, tracker };
}

function assignIncrementalOrders(items) {
  const existing = items.filter((item) => item.existing);
  for (let index = 1; index < existing.length; index += 1) {
    if (existing[index].existing.order <= existing[index - 1].existing.order) return false;
  }
  let cursor = 0;
  while (cursor < items.length) {
    if (items[cursor].existing) {
      items[cursor].order = items[cursor].existing.order;
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < items.length && !items[cursor].existing) cursor += 1;
    const count = cursor - start;
    const previous = start > 0 ? items[start - 1].order : null;
    const next = cursor < items.length ? items[cursor].existing.order : null;
    for (let offset = 0; offset < count; offset += 1) {
      if (previous === null && next === null) items[start + offset].order = offset;
      else if (previous === null) items[start + offset].order = next - (count - offset);
      else if (next === null) items[start + offset].order = previous + offset + 1;
      else items[start + offset].order = previous + ((next - previous) * (offset + 1)) / (count + 1);
    }
  }
  return true;
}

function buildIncrementalCollectionPlan(collection, prefix, trackerMap, dirtyIds, dirtyValues = null, objectKeyMap = null) {
  const used = new Set();
  const items = collection.map((value, index) => {
    let key = objectKeyMap?.get(value) || getEntityPersistenceKey(value, prefix, index);
    while (used.has(key)) key = `${key}:duplicate:${index}`;
    used.add(key);
    if (objectKeyMap && value && typeof value === "object") objectKeyMap.set(value, key);
    return { key, value, existing: trackerMap.get(key) || null, order: null };
  });
  const deleted = [...trackerMap.keys()].filter((key) => !used.has(key));
  if (!assignIncrementalOrders(items)) {
    items.forEach((item, index) => { item.order = index; });
    return {
      clear: true,
      writes: items.map((item) => makeEntityWrapper(item.key, item.order, item.value)),
      deletes: [],
      nextTracker: new Map(items.map((item) => [item.key, { order: item.order, valueRef: item.value }])),
    };
  }
  const writes = items
    .filter((item) => !item.existing || item.existing.valueRef !== item.value || dirtyIds.has(item.key) || dirtyValues?.has(item.value))
    .map((item) => makeEntityWrapper(item.key, item.order, item.value));
  return {
    clear: false,
    writes,
    deletes: deleted,
    nextTracker: new Map(items.map((item) => [item.key, { order: item.order, valueRef: item.value }])),
  };
}

function findCaseForEntityPersistence(candidate, id) {
  if (candidate === state && typeof getIndexedCaseById === "function") return getIndexedCaseById(id);
  return (candidate.cases || []).find((entry) => String(entry?.id || "") === id) || null;
}

function buildDirtyOnlyPlan(trackerMap, dirtyIds, findValue) {
  const writes = [];
  const ids = typeof dirtyIds?.keys === "function" ? dirtyIds.keys() : dirtyIds;
  for (const id of ids) {
    const existing = trackerMap.get(id);
    const value = findValue(id, existing);
    if (existing && value) writes.push(makeEntityWrapper(id, existing.order, value));
  }
  return { clear: false, writes, deletes: [], nextTracker: null };
}

function makeEntityStateMeta(candidate, metadata, savedAt) {
  const { forceFull: _forceFull, ...storedMetadata } = metadata || {};
  return {
    id: LARGE_STATE_KEY,
    format: ENTITY_STATE_FORMAT,
    formatVersion: ENTITY_STATE_FORMAT_VERSION,
    savedAt,
    schemaVersion: Number(candidate.schemaVersion || 0),
    dataSchemaVersion: Number(candidate.dataSchemaVersion || 0),
    casesCount: Number(candidate.cases?.length || 0),
    bookingsCount: Number(candidate.bookings?.length || 0),
    auditCount: Number(candidate.auditLog?.length || 0),
    metadata: storedMetadata,
    root: getEntityStateRoot(candidate),
  };
}

function snapshotEntityPersistenceMutations() {
  return {
    version: entityPersistenceMutationVersion,
    dirtyCases: new Map(dirtyEntityCases),
    deletedCaseIds: new Map(deletedEntityCaseIds),
    dirtyBookings: new Map(dirtyEntityBookings),
    deletedBookingIds: new Map(deletedEntityBookingIds),
    dirtyAuditEntries: new Map(dirtyEntityAuditEntries),
    auditStructureGeneration: entityAuditStructureGeneration,
    fullReplacementGeneration: entityStateFullReplacementGeneration,
  };
}

function buildEntityPersistencePlan(candidate, metadata, savedAt) {
  const cases = Array.isArray(candidate.cases) ? candidate.cases : [];
  const bookings = Array.isArray(candidate.bookings) ? candidate.bookings : [];
  const auditLog = Array.isArray(candidate.auditLog) ? candidate.auditLog : [];
  const mutations = snapshotEntityPersistenceMutations();
  const tracker = {
    mutationVersion: mutations.version,
    candidateSource: candidate,
    casesSource: cases,
    bookingsSource: bookings,
    auditSource: auditLog,
    casesLength: cases.length,
    bookingsLength: bookings.length,
    auditLength: auditLog.length,
  };
  const full = metadata.forceFull === true
    || !entityPersistenceTracker.initialized
    || entityPersistenceTracker.candidateSource !== candidate
    || mutations.fullReplacementGeneration > 0;
  if (full) {
    const casePlan = buildFullEntityCollection(cases, "case");
    const bookingPlan = buildFullEntityCollection(bookings, "booking");
    const auditObjectKeys = new WeakMap();
    const auditPlan = buildFullEntityCollection(auditLog, "audit", auditObjectKeys);
    return {
      full: true,
      meta: makeEntityStateMeta(candidate, metadata, savedAt),
      cases: { clear: true, writes: casePlan.records, deletes: [], nextTracker: casePlan.tracker },
      bookings: { clear: true, writes: bookingPlan.records, deletes: [], nextTracker: bookingPlan.tracker },
      audit: { clear: true, writes: auditPlan.records, deletes: [], nextTracker: auditPlan.tracker },
      auditObjectKeys,
      mutations,
      tracker,
    };
  }

  const caseStructureChanged = entityPersistenceTracker.casesSource !== cases
    || entityPersistenceTracker.casesLength !== cases.length
    || mutations.deletedCaseIds.size > 0;
  const bookingStructureChanged = entityPersistenceTracker.bookingsSource !== bookings
    || entityPersistenceTracker.bookingsLength !== bookings.length
    || mutations.deletedBookingIds.size > 0;
  const auditStructureChanged = entityPersistenceTracker.auditSource !== auditLog
    || entityPersistenceTracker.auditLength !== auditLog.length
    || mutations.auditStructureGeneration > 0;
  const dirtyCaseIds = new Set(mutations.dirtyCases.keys());
  const dirtyBookingIds = new Set(mutations.dirtyBookings.keys());
  const dirtyAuditEntries = new Set(mutations.dirtyAuditEntries.keys());
  const casePlan = caseStructureChanged
    ? buildIncrementalCollectionPlan(cases, "case", entityPersistenceTracker.cases, dirtyCaseIds)
    : buildDirtyOnlyPlan(entityPersistenceTracker.cases, dirtyCaseIds, (id, existing) => mutations.dirtyCases.get(id)?.value || findCaseForEntityPersistence(candidate, id) || existing?.valueRef);
  const bookingPlan = bookingStructureChanged
    ? buildIncrementalCollectionPlan(bookings, "booking", entityPersistenceTracker.bookings, dirtyBookingIds)
    : buildDirtyOnlyPlan(entityPersistenceTracker.bookings, dirtyBookingIds, (id, existing) => mutations.dirtyBookings.get(id)?.value || existing?.valueRef);
  const auditPlan = auditStructureChanged
    ? buildIncrementalCollectionPlan(auditLog, "audit", entityPersistenceTracker.audit, new Set(), dirtyAuditEntries, entityPersistenceTracker.auditObjectKeys)
    : { clear: false, writes: [], deletes: [], nextTracker: null };
  return {
    full: false,
    meta: makeEntityStateMeta(candidate, metadata, savedAt),
    cases: casePlan,
    bookings: bookingPlan,
    audit: auditPlan,
    auditObjectKeys: entityPersistenceTracker.auditObjectKeys,
    mutations,
    tracker,
  };
}

function applyEntityStorePlan(store, plan) {
  if (plan.clear) store.clear();
  plan.deletes.forEach((id) => store.delete(id));
  plan.writes.forEach((record) => store.put(record));
}

function getEntityMutationGeneration(marker) {
  return marker && typeof marker === "object" ? marker.generation : marker;
}

function acknowledgeEntityMutationMap(current, planned) {
  planned.forEach((plannedMarker, key) => {
    if (getEntityMutationGeneration(current.get(key)) === getEntityMutationGeneration(plannedMarker)) current.delete(key);
  });
}

function commitEntityPersistenceTracker(candidate, plan) {
  const apply = (current, collectionPlan) => {
    if (collectionPlan.nextTracker) return collectionPlan.nextTracker;
    collectionPlan.deletes.forEach((id) => current.delete(id));
    collectionPlan.writes.forEach((record) => current.set(record.id, { order: record.order, valueRef: record.value }));
    return current;
  };
  entityPersistenceTracker.initialized = true;
  entityPersistenceTracker.mutationVersion = plan.tracker.mutationVersion;
  entityPersistenceTracker.candidateSource = plan.tracker.candidateSource;
  entityPersistenceTracker.casesSource = plan.tracker.casesSource;
  entityPersistenceTracker.bookingsSource = plan.tracker.bookingsSource;
  entityPersistenceTracker.auditSource = plan.tracker.auditSource;
  entityPersistenceTracker.casesLength = plan.tracker.casesLength;
  entityPersistenceTracker.bookingsLength = plan.tracker.bookingsLength;
  entityPersistenceTracker.auditLength = plan.tracker.auditLength;
  entityPersistenceTracker.cases = apply(entityPersistenceTracker.cases, plan.cases);
  entityPersistenceTracker.bookings = apply(entityPersistenceTracker.bookings, plan.bookings);
  entityPersistenceTracker.audit = apply(entityPersistenceTracker.audit, plan.audit);
  entityPersistenceTracker.auditObjectKeys = plan.auditObjectKeys;
  acknowledgeEntityMutationMap(dirtyEntityCases, plan.mutations.dirtyCases);
  acknowledgeEntityMutationMap(deletedEntityCaseIds, plan.mutations.deletedCaseIds);
  acknowledgeEntityMutationMap(dirtyEntityBookings, plan.mutations.dirtyBookings);
  acknowledgeEntityMutationMap(deletedEntityBookingIds, plan.mutations.deletedBookingIds);
  acknowledgeEntityMutationMap(dirtyEntityAuditEntries, plan.mutations.dirtyAuditEntries);
  if (entityAuditStructureGeneration === plan.mutations.auditStructureGeneration) entityAuditStructureGeneration = 0;
  if (entityStateFullReplacementGeneration === plan.mutations.fullReplacementGeneration) entityStateFullReplacementGeneration = 0;
}

async function persistEntityState(candidate, metadata = {}) {
  if (!candidate || typeof candidate !== "object") throw new Error("État applicatif invalide.");
  const savedAt = new Date().toISOString();
  const plan = buildEntityPersistencePlan(candidate, metadata, savedAt);
  await runIndexedDbStoresTransaction(
    [ENTITY_STATE_META_STORE, ENTITY_CASE_STORE, ENTITY_BOOKING_STORE, ENTITY_AUDIT_STORE],
    "readwrite",
    (stores) => {
      applyEntityStorePlan(stores[ENTITY_CASE_STORE], plan.cases);
      applyEntityStorePlan(stores[ENTITY_BOOKING_STORE], plan.bookings);
      applyEntityStorePlan(stores[ENTITY_AUDIT_STORE], plan.audit);
      stores[ENTITY_STATE_META_STORE].put(plan.meta);
      return null;
    },
  );
  commitEntityPersistenceTracker(candidate, plan);
  lastEntityPersistenceStats = {
    savedAt,
    full: plan.full,
    rootWrites: 1,
    caseWrites: plan.cases.writes.length,
    caseDeletes: plan.cases.deletes.length,
    bookingWrites: plan.bookings.writes.length,
    bookingDeletes: plan.bookings.deletes.length,
    auditWrites: plan.audit.writes.length,
    auditDeletes: plan.audit.deletes.length,
  };
  window.NIMR_INDEXED_DB_STATUS = { ok: true, savedAt, casesCount: plan.tracker.casesLength, primary: true };
  return { ...lastEntityPersistenceStats, casesCount: plan.tracker.casesLength, bookingsCount: plan.tracker.bookingsLength };
}

function persistLargeStateSnapshot(candidate = state, metadata = {}) {
  const run = entityPersistenceTail.then(
    () => persistEntityState(candidate, metadata),
    () => persistEntityState(candidate, metadata),
  );
  entityPersistenceTail = run.catch(() => null);
  return run;
}

async function loadEntityStateSnapshot() {
  const result = await runIndexedDbStoresTransaction(
    [ENTITY_STATE_META_STORE, ENTITY_CASE_STORE, ENTITY_BOOKING_STORE, ENTITY_AUDIT_STORE],
    "readonly",
    (stores) => {
      const metaRequest = stores[ENTITY_STATE_META_STORE].get(LARGE_STATE_KEY);
      const caseRequest = stores[ENTITY_CASE_STORE].getAll();
      const bookingRequest = stores[ENTITY_BOOKING_STORE].getAll();
      const auditRequest = stores[ENTITY_AUDIT_STORE].getAll();
      return () => ({
        meta: metaRequest.result || null,
        cases: caseRequest.result || [],
        bookings: bookingRequest.result || [],
        auditLog: auditRequest.result || [],
      });
    },
  );
  const meta = result?.meta;
  if (meta?.format !== ENTITY_STATE_FORMAT || Number(meta.formatVersion) !== ENTITY_STATE_FORMAT_VERSION) return null;
  const sortRecords = (records) => records.slice().sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  const caseRecords = sortRecords(result.cases);
  const bookingRecords = sortRecords(result.bookings);
  const auditRecords = sortRecords(result.auditLog);
  if (
    caseRecords.length !== Number(meta.casesCount || 0)
    || bookingRecords.length !== Number(meta.bookingsCount || 0)
    || auditRecords.length !== Number(meta.auditCount || 0)
  ) throw new Error("État IndexedDB incomplet : compteurs d'entités incohérents.");
  const restoredState = {
    ...(meta.root && typeof meta.root === "object" ? meta.root : {}),
    cases: caseRecords.map((record) => record.value),
    bookings: bookingRecords.map((record) => record.value),
    auditLog: auditRecords.map((record) => record.value),
  };
  return {
    id: meta.id,
    format: meta.format,
    formatVersion: meta.formatVersion,
    savedAt: meta.savedAt,
    schemaVersion: meta.schemaVersion,
    dataSchemaVersion: meta.dataSchemaVersion,
    casesCount: meta.casesCount,
    bookingsCount: meta.bookingsCount,
    auditCount: meta.auditCount,
    metadata: meta.metadata,
    state: restoredState,
    entityPersistence: { caseRecords, bookingRecords, auditRecords },
  };
}

async function loadLegacyLargeStateSnapshot() {
  const record = await runLargeStateTransaction("readonly", (store) => store.get(LARGE_STATE_KEY));
  if (!record) return null;
  let restoredState = record.state;
  if ((!restoredState || !Array.isArray(restoredState.cases)) && typeof record.stateJson === "string") {
    try {
      restoredState = JSON.parse(record.stateJson);
    } catch {
      return null;
    }
  }
  if (!restoredState || !Array.isArray(restoredState.cases)) return null;
  const { stateJson, ...metadata } = record;
  window.NIMR_INDEXED_DB_STATUS = { ok: true, savedAt: record.savedAt || "", casesCount: restoredState.cases.length, primary: true };
  return { ...metadata, state: restoredState };
}

async function loadLargeStateSnapshot() {
  const entityRecord = await loadEntityStateSnapshot();
  if (entityRecord?.state) {
    window.NIMR_INDEXED_DB_STATUS = { ok: true, savedAt: entityRecord.savedAt || "", casesCount: entityRecord.state.cases.length, primary: true, entityState: true };
    return entityRecord;
  }
  const legacyRecord = await loadLegacyLargeStateSnapshot();
  if (!legacyRecord?.state) return null;
  try {
    await persistLargeStateSnapshot(legacyRecord.state, { reason: "legacy-v2-migration", forceFull: true });
    const migrated = await loadEntityStateSnapshot();
    if (!migrated?.state
      || migrated.state.cases.length !== legacyRecord.state.cases.length
      || migrated.state.bookings.length !== (legacyRecord.state.bookings || []).length) {
      throw new Error("Vérification de migration IndexedDB incomplète.");
    }
    return { ...migrated, migratedFromLegacy: true, legacyRetained: true };
  } catch (error) {
    return { ...legacyRecord, migrationFailed: true, migrationError: error?.message || String(error), legacyRetained: true };
  }
}

async function removeLargeStateSnapshot() {
  await runIndexedDbStoresTransaction(
    [LARGE_STATE_STORE, ENTITY_STATE_META_STORE, ENTITY_CASE_STORE, ENTITY_BOOKING_STORE, ENTITY_AUDIT_STORE],
    "readwrite",
    (stores) => {
      stores[LARGE_STATE_STORE].delete(LARGE_STATE_KEY);
      stores[ENTITY_STATE_META_STORE].clear();
      stores[ENTITY_CASE_STORE].clear();
      stores[ENTITY_BOOKING_STORE].clear();
      stores[ENTITY_AUDIT_STORE].clear();
      return null;
    },
  );
  markEntityStateFullReplacement();
}

function adoptHydratedEntityState(candidate, entityPersistence) {
  if (!candidate || !entityPersistence) return;
  const adopt = (values, records) => new Map(records.map((record, index) => [
    record.id,
    { order: record.order, valueRef: values[index] },
  ]));
  const auditObjectKeys = new WeakMap();
  entityPersistence.auditRecords.forEach((record, index) => {
    const value = candidate.auditLog[index];
    if (value && typeof value === "object") auditObjectKeys.set(value, record.id);
  });
  entityPersistenceTracker = {
    initialized: true,
    mutationVersion: entityPersistenceMutationVersion,
    candidateSource: candidate,
    casesSource: candidate.cases,
    bookingsSource: candidate.bookings,
    auditSource: candidate.auditLog,
    casesLength: candidate.cases.length,
    bookingsLength: candidate.bookings.length,
    auditLength: candidate.auditLog.length,
    cases: adopt(candidate.cases, entityPersistence.caseRecords),
    bookings: adopt(candidate.bookings, entityPersistence.bookingRecords),
    audit: adopt(candidate.auditLog, entityPersistence.auditRecords),
    auditObjectKeys,
  };
}

async function hydrateLargeStateIfAvailable() {
  const record = await loadLargeStateSnapshot().catch(() => null);
  if (!record?.state) return { hydrated: false, record: null };
  const previousSelection = typeof captureCaseSelectionIdentity === "function"
    ? captureCaseSelectionIdentity()
    : { id: activeCaseId };
  const migrated = typeof migrateLegacyState === "function"
    ? migrateLegacyState(record.state).state
    : record.state;
  state = normalizeState(migrated);
  if (record.entityPersistence) adoptHydratedEntityState(state, record.entityPersistence);
  if (typeof initializeLastKnownCasesComparable === "function") {
    initializeLastKnownCasesComparable();
  }
  if (typeof reconcileActiveCaseSelection === "function") reconcileActiveCaseSelection(previousSelection);
  return { hydrated: true, record };
}

function makeOutboxIdentifier(prefix = "operation") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
  if (typeof uid === "function") return uid(prefix);
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOutboxWorkshopId() {
  return typeof getSupabaseWorkshopId === "function" ? getSupabaseWorkshopId() : "local-workshop";
}

function getOutboxUserId() {
  if (typeof getCurrentActor === "function") return String(getCurrentActor()?.userId || "");
  return String(state?.currentUserId || "");
}

function hashSyncSnapshotString(value = "") {
  const input = String(value || "");
  let hashA = 2166136261;
  let hashB = 2654435769;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 2246822519);
  }
  return [
    "v1",
    input.length,
    (hashA >>> 0).toString(16).padStart(8, "0"),
    (hashB >>> 0).toString(16).padStart(8, "0"),
  ].join(":");
}

function cloneSyncStateSnapshot(candidateState = state) {
  return JSON.parse(JSON.stringify(candidateState || {}));
}

function buildSyncFingerprintState(candidateState = state) {
  const snapshot = cloneSyncStateSnapshot(candidateState);
  delete snapshot.syncLog;
  return snapshot;
}

function getSyncStateFingerprint(candidateState = state) {
  return hashSyncSnapshotString(
    JSON.stringify(buildSyncFingerprintState(candidateState)),
  );
}

const DURABLE_OUTBOX_MAX_RETRY_COUNT = 10;
let durableOutboxMutationTail = Promise.resolve();

function normalizeOutboxExpectedVersion(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeOutboxSnapshotFingerprint(value) {
  return String(value || "").trim();
}

function getDurableOutboxEquivalenceKey(input = {}) {
  const operation = normalizeDurableOutboxOperation(input);
  return [
    operation.workshopId,
    operation.entityType,
    operation.entityId,
    operation.action,
    operation.baseVersion === null ? "null" : String(operation.baseVersion),
    operation.snapshotFingerprint || "no-fingerprint",
  ].join("|");
}

function isGranularCoalescibleOperation(operation = {}) {
  return ["case", "booking", "workshop_settings"].includes(String(operation.entityType || ""))
    && ["upsert", "delete"].includes(String(operation.action || ""));
}

function getDurableOutboxEntityKey(operation = {}) {
  return [operation.workshopId, operation.entityType, operation.entityId]
    .map((part) => String(part || ""))
    .join("|");
}

function areDurableOutboxOperationsEquivalent(left, right) {
  return getDurableOutboxEquivalenceKey(left) === getDurableOutboxEquivalenceKey(right);
}

function isSupersedableSnapshotOperation(operation = {}) {
  return String(operation.entityType || "") === "workshop_state"
    && String(operation.action || "") === "upsert_snapshot";
}

function areDurableOutboxOperationsSameSnapshotTarget(left = {}, right = {}) {
  if (!isSupersedableSnapshotOperation(left) || !isSupersedableSnapshotOperation(right)) return false;
  return String(left.workshopId || "") === String(right.workshopId || "")
    && String(left.entityType || "") === String(right.entityType || "")
    && String(left.entityId || "") === String(right.entityId || "")
    && String(left.action || "") === String(right.action || "");
}

function getDurableOutboxConsolidationKey(operation = {}) {
  if (!isSupersedableSnapshotOperation(operation)) {
    return getDurableOutboxEquivalenceKey(operation);
  }
  return [
    "latest-snapshot",
    operation.workshopId,
    operation.entityType,
    operation.entityId,
    operation.action,
  ].map((part) => String(part || "")).join("|");
}

function runDurableOutboxMutation(callback) {
  const run = durableOutboxMutationTail.then(callback, callback);
  durableOutboxMutationTail = run.catch(() => null);
  return run;
}

function chooseMergedOutboxStatus(entries, candidate) {
  const processing = entries.find((entry) => entry.syncStatus === "processing");
  if (processing) {
    const processingFingerprint = normalizeOutboxSnapshotFingerprint(
      processing.snapshotFingerprint || processing.payload?.snapshotFingerprint,
    );
    const candidateFingerprint = normalizeOutboxSnapshotFingerprint(
      candidate.snapshotFingerprint || candidate.payload?.snapshotFingerprint,
    );
    if (
      isSupersedableSnapshotOperation(candidate)
      && candidateFingerprint
      && processingFingerprint
      && candidateFingerprint !== processingFingerprint
    ) {
      return "pending";
    }
    return "processing";
  }
  if (candidate.syncStatus === "pending" || entries.some((entry) => entry.syncStatus === "pending")) return "pending";
  if (candidate.syncStatus === "conflicted" || entries.some((entry) => entry.syncStatus === "conflicted")) return "conflicted";
  return "failed";
}

function mergeEquivalentOutboxOperations(entries, candidate) {
  const processing = entries.find((entry) => entry.syncStatus === "processing");
  const keeper = processing || entries[0] || candidate;
  const syncStatus = chooseMergedOutboxStatus(entries, candidate);
  const retryValues = [...entries, candidate].map((entry) => Math.max(0, Number(entry.retryCount || 0)));
  const retryCount = syncStatus === "processing"
    ? Math.min(DURABLE_OUTBOX_MAX_RETRY_COUNT, Math.max(0, Number(keeper.retryCount || 0)))
    : Math.min(DURABLE_OUTBOX_MAX_RETRY_COUNT, Math.min(...retryValues));
  return normalizeDurableOutboxOperation({
    ...keeper,
    ...candidate,
    operationId: keeper.operationId,
    idempotencyKey: keeper.idempotencyKey,
    createdAt: keeper.createdAt,
    baseVersion: isGranularCoalescibleOperation(candidate) ? keeper.baseVersion : candidate.baseVersion,
    expectedVersion: isGranularCoalescibleOperation(candidate) ? keeper.baseVersion : candidate.baseVersion,
    payload: isGranularCoalescibleOperation(candidate)
      ? cloneGranularSyncValue(candidate.payload || {})
      : {
        ...(keeper.payload || {}),
        ...(candidate.payload || {}),
      },
    syncStatus,
    retryCount,
    lastError: syncStatus === "pending" || syncStatus === "processing" ? "" : String(candidate.lastError || keeper.lastError || ""),
    updatedAt: new Date().toISOString(),
  });
}

async function replaceDurableOutboxOperations(records = []) {
  const normalized = records.map(normalizeDurableOutboxOperation)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  if (typeof indexedDB === "undefined") {
    writeOutboxFallback(normalized);
  } else {
    await runIndexedDbTransaction(DURABLE_OUTBOX_STORE, "readwrite", (store) => {
      store.clear();
      normalized.forEach((entry) => store.put(entry));
      return null;
    });
  }
  publishDurableOutboxMirror(normalized);
  return normalized;
}

async function consolidateDurableOutboxOperations() {
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const groups = new Map();
    const retained = [];
    records.forEach((entry) => {
      // Only never-sent pending envelopes are mutable. Processing, failed, and
      // conflicted operations may already be known to the server.
      if (entry.syncStatus !== "pending") {
        retained.push(entry);
        return;
      }
      const key = getDurableOutboxConsolidationKey(entry);
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      const newest = group[group.length - 1];
      retained.push(mergeEquivalentOutboxOperations(group, newest));
    });
    return replaceDurableOutboxOperations(retained);
  });
}

async function acknowledgeEquivalentDurableOutboxOperations(reference, acknowledgement = {}) {
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const equivalent = records.filter((entry) => (
      isSendableDurableOutboxSyncStatus(entry.syncStatus)
      && areDurableOutboxOperationsEquivalent(entry, reference)
    ));
    const equivalentIds = new Set(equivalent.map((entry) => entry.operationId));
    const retained = records.filter((entry) => !equivalentIds.has(entry.operationId));
    await replaceDurableOutboxOperations(retained);
    return {
      acknowledged: equivalent.map((entry) => ({
        ...entry,
        syncStatus: "acknowledged",
        retryCount: Math.min(DURABLE_OUTBOX_MAX_RETRY_COUNT, Number(entry.retryCount || 0)),
        lastError: "",
        acknowledgedAt: acknowledgement.updatedAt || new Date().toISOString(),
      })),
      remaining: retained,
    };
  });
}

function normalizeDurableOutboxOperation(input = {}) {
  const createdAt = input.createdAt || new Date().toISOString();
  const operationId = String(input.operationId || input.id || makeOutboxIdentifier("operation"));
  const inputEntityType = String(input.entityType || "workshop_state");
  // A P0-009 mutable envelope has no baseVersion; its expectedVersion was a
  // localRevision-domain value and must never be reinterpreted as server CAS.
  const rawBaseVersion = Object.hasOwn(input, "baseVersion")
    ? input.baseVersion
    : (["case", "booking", "workshop_settings"].includes(inputEntityType) ? null : input.expectedVersion);
  return {
    operationId,
    idempotencyKey: String(input.idempotencyKey || `${input.workshopId || getOutboxWorkshopId()}:${operationId}`),
    entityType: inputEntityType,
    entityId: String(input.entityId || input.workshopId || getOutboxWorkshopId()),
    action: String(input.action || "upsert_snapshot"),
    payload: input.payload && typeof input.payload === "object" ? cloneGranularSyncValue(input.payload) : {},
    workshopId: String(input.workshopId || getOutboxWorkshopId()),
    userId: String(input.userId || getOutboxUserId()),
    baseVersion: normalizeOutboxExpectedVersion(rawBaseVersion),
    expectedVersion: normalizeOutboxExpectedVersion(rawBaseVersion),
    entityVersion: normalizeOutboxExpectedVersion(input.entityVersion),
    snapshotFingerprint: normalizeOutboxSnapshotFingerprint(
      input.snapshotFingerprint || input.payload?.snapshotFingerprint,
    ),
    retryCount: Math.min(DURABLE_OUTBOX_MAX_RETRY_COUNT, Math.max(0, Number(input.retryCount || input.attempts || 0))),
    lastError: String(input.lastError || input.error || ""),
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    syncStatus: ["pending", "processing", "settling", "failed", "conflicted", "conflict", "acknowledged"].includes(input.syncStatus || input.status)
      ? ((input.syncStatus || input.status) === "conflict" ? "conflicted" : (input.syncStatus || input.status))
      : "pending",
    conflictId: String(input.conflictId || ""),
    serverVersion: normalizeOutboxExpectedVersion(input.serverVersion),
    canonical: input.canonical && typeof input.canonical === "object" ? cloneGranularSyncValue(input.canonical) : null,
    conflictServerVersion: normalizeOutboxExpectedVersion(input.conflictServerVersion),
    conflictCanonical: input.conflictCanonical && typeof input.conflictCanonical === "object" ? cloneGranularSyncValue(input.conflictCanonical) : null,
    conflictBaseVersion: normalizeOutboxExpectedVersion(input.conflictBaseVersion),
    conflictLocalPayload: input.conflictLocalPayload && typeof input.conflictLocalPayload === "object" ? cloneGranularSyncValue(input.conflictLocalPayload) : null,
    conflictServerPayload: input.conflictServerPayload && typeof input.conflictServerPayload === "object" ? cloneGranularSyncValue(input.conflictServerPayload) : null,
    conflictDetectedAt: input.conflictDetectedAt || null,
    replacesOperationIds: Array.isArray(input.replacesOperationIds) ? input.replacesOperationIds.map(String) : [],
    replacesConflictIds: Array.isArray(input.replacesConflictIds) ? input.replacesConflictIds.map(String) : [],
    replacesLocalConflictIds: Array.isArray(input.replacesLocalConflictIds) ? input.replacesLocalConflictIds.map(String) : [],
    casAcknowledged: Boolean(input.casAcknowledged),
    casObserved: input.casObserved && typeof input.casObserved === "object" ? cloneGranularSyncValue(input.casObserved) : null,
    casAcknowledgement: input.casAcknowledgement && typeof input.casAcknowledgement === "object" ? cloneGranularSyncValue(input.casAcknowledgement) : null,
    resolvedConflictIds: Array.isArray(input.resolvedConflictIds) ? input.resolvedConflictIds.map(String) : [],
    equivalentConflictId: String(input.equivalentConflictId || ""),
    description: String(input.description || "Mise à jour des données"),
  };
}

function readOutboxFallback() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DURABLE_OUTBOX_FALLBACK_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeDurableOutboxOperation) : [];
  } catch {
    return [];
  }
}

function writeOutboxFallback(records) {
  localStorage.setItem(DURABLE_OUTBOX_FALLBACK_KEY, JSON.stringify(records || []));
}

function publishDurableOutboxMirror(records = []) {
  const compact = records.map((record) => ({
    operationId: record.operationId,
    entityType: record.entityType,
    entityId: record.entityId,
    action: record.action,
    workshopId: record.workshopId,
    baseVersion: record.baseVersion,
    expectedVersion: record.baseVersion,
    snapshotFingerprint: record.snapshotFingerprint,
    retryCount: record.retryCount,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    syncStatus: record.syncStatus,
  }));
  durableOutboxEntityBaseVersions.clear();
  compact.forEach((entry) => {
    if (!isActiveDurableOutboxSyncStatus(entry.syncStatus)) return;
    const entityKey = [entry.workshopId, entry.entityType, entry.entityId].map((value) => String(value || "")).join("|");
    if (!durableOutboxEntityBaseVersions.has(entityKey)) {
      durableOutboxEntityBaseVersions.set(entityKey, entry.baseVersion);
    }
  });
  try {
    localStorage.setItem(DURABLE_OUTBOX_MIRROR_KEY, JSON.stringify(compact));
    localStorage.setItem("nimr-sav-offline-queue", JSON.stringify(compact.map((entry) => ({
      id: entry.operationId,
      operationId: entry.operationId,
      type: ["case", "booking", "workshop_settings", "workshop_state"].includes(entry.entityType)
        ? "sync_push"
        : entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      workshopId: entry.workshopId,
      baseVersion: entry.baseVersion,
      expectedVersion: entry.baseVersion,
      snapshotFingerprint: entry.snapshotFingerprint,
      status: entry.syncStatus === "acknowledged" ? "success" : entry.syncStatus,
      attempts: entry.retryCount,
      error: entry.lastError,
      timestamp: entry.createdAt,
    }))));
  } catch {
    // Le miroir compact est informatif ; IndexedDB reste la source durable.
  }
  window.NIMR_OUTBOX_STATUS = {
    pending: compact.filter((entry) => isActiveDurableOutboxSyncStatus(entry.syncStatus)).length,
    conflicts: compact.filter((entry) => entry.syncStatus === "conflicted").length,
    failed: compact.filter((entry) => entry.syncStatus === "failed").length,
    lastError: compact.slice().reverse().find((entry) => entry.lastError)?.lastError || "",
    operations: compact,
    updatedAt: new Date().toISOString(),
  };
  return window.NIMR_OUTBOX_STATUS;
}

async function loadDurableOutboxOperations() {
  let records;
  if (typeof indexedDB === "undefined") {
    records = readOutboxFallback();
  } else {
    records = await runIndexedDbTransaction(DURABLE_OUTBOX_STORE, "readonly", (store) => store.getAll());
  }
  records = (records || []).map(normalizeDurableOutboxOperation)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  publishDurableOutboxMirror(records);
  return records;
}

async function putDurableOutboxOperation(input) {
  const operation = normalizeDurableOutboxOperation(input);
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const existing = records.find((entry) => entry.operationId === operation.operationId);
    if (existing && existing.syncStatus !== "pending") return existing;
    const retained = records.filter((entry) => entry.operationId !== operation.operationId);
    retained.push(operation);
    await replaceDurableOutboxOperations(retained);
    return operation;
  });
}

async function deleteDurableOutboxOperation(operationId) {
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    return replaceDurableOutboxOperations(records.filter((entry) => entry.operationId !== operationId));
  });
}

function mergeDurableOutboxCandidate(records, candidate) {
    const sameOperation = records.find((entry) => entry.operationId === candidate.operationId);
    if (sameOperation) {
      if (sameOperation.syncStatus !== "pending") {
        return { operation: sameOperation, records };
      }
      const replacement = normalizeDurableOutboxOperation({
        ...sameOperation,
        ...candidate,
        operationId: sameOperation.operationId,
        idempotencyKey: sameOperation.idempotencyKey,
        createdAt: sameOperation.createdAt,
      });
      return {
        operation: replacement,
        records: [...records.filter((entry) => entry.operationId !== sameOperation.operationId), replacement],
      };
    }
    const mergeable = records.filter((entry) => (
      entry.syncStatus === "pending"
      && (
        (
          entry.syncStatus === "pending"
          && isGranularCoalescibleOperation(entry)
          && isGranularCoalescibleOperation(candidate)
          && getDurableOutboxEntityKey(entry) === getDurableOutboxEntityKey(candidate)
        )
        || areDurableOutboxOperationsEquivalent(entry, candidate)
        || areDurableOutboxOperationsSameSnapshotTarget(entry, candidate)
      )
    ));
    if (!mergeable.length) {
      return { operation: candidate, records: [...records, candidate] };
    }
    const mergeableIds = new Set(mergeable.map((entry) => entry.operationId));
    const merged = mergeEquivalentOutboxOperations(mergeable, candidate);
    const retained = records.filter((entry) => !mergeableIds.has(entry.operationId));
    retained.push(merged);
    return { operation: merged, records: retained };
}

async function enqueueDurableOutboxOperation(input = {}) {
  const candidate = normalizeDurableOutboxOperation(input);
  if (typeof indexedDB === "undefined") {
    const merged = mergeDurableOutboxCandidate(readOutboxFallback(), candidate);
    const normalized = merged.records.map(normalizeDurableOutboxOperation)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    writeOutboxFallback(normalized);
    publishDurableOutboxMirror(normalized);
    return merged.operation;
  }
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const merged = mergeDurableOutboxCandidate(records, candidate);
    await replaceDurableOutboxOperations(merged.records);
    return merged.operation;
  });
}

async function acknowledgeDurableOutboxOperation(operationId, acknowledgement = {}) {
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const matched = records.find((entry) => entry.operationId === String(operationId || ""));
    if (!matched) return { acknowledged: null, remaining: records };
    const retained = records.filter((entry) => entry.operationId !== matched.operationId);
    await replaceDurableOutboxOperations(retained);
    return {
      acknowledged: {
        ...matched,
        syncStatus: "acknowledged",
        lastError: "",
        acknowledgedAt: acknowledgement.updatedAt || new Date().toISOString(),
      },
      remaining: retained,
    };
  });
}

function getDurableOutboxDependencyRank(operation = {}) {
  if (operation.action === "delete") {
    if (operation.entityType === "booking") return 40;
    if (operation.entityType === "case") return 50;
    return 60;
  }
  if (operation.entityType === "case") return 10;
  if (operation.entityType === "booking") return 20;
  if (operation.entityType === "workshop_settings") return 30;
  if (operation.entityType === "audit") return 35;
  return 70;
}

function sortDurableOutboxOperationsForSend(operations = []) {
  return operations.slice().sort((left, right) => (
    getDurableOutboxDependencyRank(left) - getDurableOutboxDependencyRank(right)
    || String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
    || String(left.operationId || "").localeCompare(String(right.operationId || ""))
  ));
}

function getGranularCursorRowId(row = {}) {
  return String(row.entity_id || row.local_id || row.id || "");
}

function selectGranularRowsAfterCursor(rows = [], cursor = null, pageSize = 500) {
  const size = Math.max(1, Math.min(1000, Number(pageSize || 500)));
  const sorted = rows.slice().sort((left, right) => (
    String(left.updated_at || "").localeCompare(String(right.updated_at || ""))
    || getGranularCursorRowId(left).localeCompare(getGranularCursorRowId(right))
  ));
  const filtered = cursor ? sorted.filter((row) => {
    const timeCompare = String(row.updated_at || "").localeCompare(String(cursor.updatedAt || ""));
    return timeCompare > 0 || (timeCompare === 0 && getGranularCursorRowId(row) > String(cursor.entityId || ""));
  }) : sorted;
  const pageRows = filtered.slice(0, size);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    cursor: last ? { updatedAt: String(last.updated_at || ""), entityId: getGranularCursorRowId(last) } : cursor,
    hasMore: filtered.length > pageRows.length,
  };
}

async function loadSyncMetadata(key) {
  const normalizedKey = String(key || "");
  if (!normalizedKey) return null;
  if (typeof indexedDB === "undefined") {
    try { return JSON.parse(localStorage.getItem(`nimr-sav-sync-metadata:${normalizedKey}`) || "null"); } catch { return null; }
  }
  return runIndexedDbTransaction(SYNC_METADATA_STORE, "readonly", (store) => store.get(normalizedKey));
}

async function putSyncMetadata(key, value = {}) {
  const record = { key: String(key || ""), ...cloneGranularSyncValue(value), updatedAt: new Date().toISOString() };
  if (!record.key) throw new Error("Clé sync_metadata requise.");
  if (typeof indexedDB === "undefined") {
    localStorage.setItem(`nimr-sav-sync-metadata:${record.key}`, JSON.stringify(record));
    return record;
  }
  await runIndexedDbTransaction(SYNC_METADATA_STORE, "readwrite", (store) => store.put(record));
  return record;
}

async function hydrateObservedGranularEntityMetadata(workshopId = "") {
  let records = [];
  if (typeof indexedDB === "undefined") {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(`nimr-sav-sync-metadata:${OBSERVED_GRANULAR_METADATA_PREFIX}`)) continue;
      try { records.push(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { /* ignore corrupt metadata */ }
    }
  } else {
    records = await runIndexedDbTransaction(SYNC_METADATA_STORE, "readonly", (store) => store.getAll());
  }
  const normalizedWorkshopId = String(workshopId || "");
  (records || []).filter((record) => String(record?.key || "").startsWith(OBSERVED_GRANULAR_METADATA_PREFIX))
    .map(normalizeObservedGranularMetadata)
    .filter((record) => !normalizedWorkshopId || record.workshopId === normalizedWorkshopId)
    .forEach((record) => observedGranularEntityMetadata.set(record.key, record));
  return [...observedGranularEntityMetadata.values()]
    .filter((record) => !normalizedWorkshopId || record.workshopId === normalizedWorkshopId);
}

async function rememberObservedGranularEntityMetadata(value = {}) {
  const record = normalizeObservedGranularMetadata(value);
  if (!record.entityType || !record.entityId) throw new Error("Identité canonique observée requise.");
  const persisted = await runDurableOutboxMutation(async () => {
    if (typeof indexedDB === "undefined") {
      const current = await loadSyncMetadata(record.key);
      const selected = selectMonotonicObservedGranularMetadata(current, record);
      if (current && selected.serverVersion === normalizeObservedGranularMetadata(current).serverVersion
        && selected.serverVersion !== record.serverVersion) return selected;
      return normalizeObservedGranularMetadata(await putSyncMetadata(record.key, selected));
    }
    let selected = record;
    await runIndexedDbStoresTransaction(SYNC_METADATA_STORE, "readwrite", (stores) => {
      const store = stores[SYNC_METADATA_STORE];
      const request = store.get(record.key);
      request.onsuccess = () => {
        selected = selectMonotonicObservedGranularMetadata(request.result, record);
        if (!request.result || selected.serverVersion === record.serverVersion) store.put(selected);
      };
      return null;
    });
    return selected;
  });
  observedGranularEntityMetadata.set(persisted.key, persisted);
  return persisted;
}

async function findActiveDurableOutboxOperationForEntity(workshopId, entityType, entityId) {
  const records = await loadDurableOutboxOperations();
  return records.find((entry) => (
    entry.workshopId === String(workshopId || "")
    && entry.entityType === String(entityType || "")
    && entry.entityId === String(entityId || "")
    && isActiveDurableOutboxSyncStatus(entry.syncStatus)
  )) || null;
}

async function completeDurableOutboxOperationAtomically(operationId, observedValue = {}, acknowledgement = {}) {
  const id = String(operationId || "");
  const observed = normalizeObservedGranularMetadata(observedValue);
  if (!id || !observed.entityType || !observed.entityId) throw new Error("Accusé CAS incomplet.");
  if (typeof indexedDB === "undefined") {
    const records = readOutboxFallback();
    const matched = records.find((entry) => entry.operationId === id) || null;
    if (!matched) return { acknowledged: null, remaining: records };
    const currentObserved = await loadSyncMetadata(observed.key);
    const settledObserved = selectMonotonicObservedGranularMetadata(currentObserved, observed);
    // localStorage cannot span keys transactionally. Keep a recovery journal
    // until both bounded records are durable.
    const journalKey = `nimr-sav-cas-commit:${id}`;
    localStorage.setItem(journalKey, JSON.stringify({ operationId: id, observed: settledObserved }));
    await putSyncMetadata(settledObserved.key, settledObserved);
    const deleteIds = new Set([id, ...(Array.isArray(matched.replacesOperationIds) ? matched.replacesOperationIds : [])]);
    const retained = records.filter((entry) => !deleteIds.has(entry.operationId));
    writeOutboxFallback(retained);
    localStorage.removeItem(journalKey);
    observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
    publishDurableOutboxMirror(retained);
    return { acknowledged: { ...matched, syncStatus: "acknowledged", acknowledgedAt: acknowledgement.updatedAt || new Date().toISOString() }, remaining: retained };
  }
  const result = await runDurableOutboxMutation(async () => {
    let acknowledged = null;
    let settledObserved = null;
    await runIndexedDbStoresTransaction(
      [DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE],
      "readwrite",
      (stores) => {
        const request = stores[DURABLE_OUTBOX_STORE].get(id);
        request.onsuccess = () => {
          if (!request.result) return;
          acknowledged = normalizeDurableOutboxOperation(request.result);
          const metadataRequest = stores[SYNC_METADATA_STORE].get(observed.key);
          metadataRequest.onsuccess = () => {
            settledObserved = selectMonotonicObservedGranularMetadata(metadataRequest.result, observed);
            stores[SYNC_METADATA_STORE].put(settledObserved);
            stores[DURABLE_OUTBOX_STORE].delete(id);
            if (Array.isArray(acknowledged.replacesOperationIds)) {
              acknowledged.replacesOperationIds.forEach((oldId) => {
                stores[DURABLE_OUTBOX_STORE].delete(String(oldId));
              });
            }
          };
        };
        return null;
      },
    );
    const remaining = await loadDurableOutboxOperations();
    return { acknowledged, remaining, settledObserved };
  });
  if (result.acknowledged && result.settledObserved) {
    observedGranularEntityMetadata.set(result.settledObserved.key, result.settledObserved);
  }
  return { acknowledged: result.acknowledged, remaining: result.remaining };
}

async function conflictDurableOutboxOperationAtomically(operationId, observedValue = {}, conflict = {}) {
  const id = String(operationId || "");
  const observed = normalizeObservedGranularMetadata(observedValue);
  if (!id || !observed.entityType || !observed.entityId) throw new Error("Transition de conflit CAS incomplète.");
  const changes = {
    syncStatus: "conflicted",
    conflictId: String(conflict.conflictId || conflict.id || ""),
    serverVersion: normalizeOutboxExpectedVersion(conflict.serverVersion ?? observed.serverVersion),
    canonical: conflict.canonical || null,
    conflictServerVersion: normalizeOutboxExpectedVersion(conflict.conflictServerVersion),
    conflictCanonical: conflict.conflictCanonical || null,
    conflictBaseVersion: normalizeOutboxExpectedVersion(conflict.baseVersion),
    conflictLocalPayload: conflict.localPayload || null,
    conflictServerPayload: conflict.serverPayload || null,
    conflictDetectedAt: conflict.detectedAt || null,
    lastError: String(conflict.message || "Conflit de concurrence serveur"),
  };
  if (typeof indexedDB === "undefined") {
    const records = readOutboxFallback();
    const current = records.find((entry) => entry.operationId === id);
    if (!current) return null;
    const updated = normalizeDurableOutboxOperation({ ...current, ...changes, operationId: id });
    const next = records.map((entry) => entry.operationId === id ? updated : entry);
    const currentObserved = await loadSyncMetadata(observed.key);
    const settledObserved = selectMonotonicObservedGranularMetadata(currentObserved, observed);
    const journalKey = `nimr-sav-cas-conflict:${id}`;
    localStorage.setItem(journalKey, JSON.stringify({ operation: updated, observed: settledObserved }));
    await putSyncMetadata(settledObserved.key, settledObserved);
    writeOutboxFallback(next);
    localStorage.removeItem(journalKey);
    observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
    publishDurableOutboxMirror(next);
    return updated;
  }
  let updated = null;
  let settledObserved = null;
  await runDurableOutboxMutation(async () => {
    await runIndexedDbStoresTransaction(
      [DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE],
      "readwrite",
      (stores) => {
        const request = stores[DURABLE_OUTBOX_STORE].get(id);
        request.onsuccess = () => {
          if (!request.result) return;
          updated = normalizeDurableOutboxOperation({ ...request.result, ...changes, operationId: id });
          const metadataRequest = stores[SYNC_METADATA_STORE].get(observed.key);
          metadataRequest.onsuccess = () => {
            settledObserved = selectMonotonicObservedGranularMetadata(metadataRequest.result, observed);
            stores[SYNC_METADATA_STORE].put(settledObserved);
            stores[DURABLE_OUTBOX_STORE].put(updated);
          };
        };
        return null;
      },
    );
    await loadDurableOutboxOperations();
  });
  if (updated && settledObserved) observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
  return updated;
}

async function resolveConflictedOutboxOperationAtomically(operationId, observedValue = {}, replacementInput = null) {
  const id = String(operationId || "");
  const observed = normalizeObservedGranularMetadata(observedValue);
  const replacement = replacementInput ? normalizeDurableOutboxOperation(replacementInput) : null;
  if (!id || !observed.entityType || !observed.entityId) throw new Error("Résolution de conflit CAS incomplète.");
  if (replacement && replacement.operationId === id) throw new Error("KEEP LOCAL exige un nouvel operationId.");
  if (typeof indexedDB === "undefined") {
    const records = readOutboxFallback();
    const current = records.find((entry) => entry.operationId === id);
    if (!current) return { resolved: null, replacement: null };
    const next = records.filter((entry) => entry.operationId !== id);
    if (replacement) next.push(replacement);
    const currentObserved = await loadSyncMetadata(observed.key);
    const settledObserved = selectMonotonicObservedGranularMetadata(currentObserved, observed);
    const journalKey = `nimr-sav-cas-resolution:${id}`;
    localStorage.setItem(journalKey, JSON.stringify({ operationId: id, observed: settledObserved, replacement }));
    await putSyncMetadata(settledObserved.key, settledObserved);
    writeOutboxFallback(next);
    localStorage.removeItem(journalKey);
    observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
    publishDurableOutboxMirror(next);
    return { resolved: current, replacement };
  }
  let resolved = null;
  let settledObserved = null;
  await runDurableOutboxMutation(async () => {
    await runIndexedDbStoresTransaction(
      [DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE],
      "readwrite",
      (stores) => {
        const request = stores[DURABLE_OUTBOX_STORE].get(id);
        request.onsuccess = () => {
          if (!request.result) return;
          resolved = normalizeDurableOutboxOperation(request.result);
          const metadataRequest = stores[SYNC_METADATA_STORE].get(observed.key);
          metadataRequest.onsuccess = () => {
            settledObserved = selectMonotonicObservedGranularMetadata(metadataRequest.result, observed);
            stores[SYNC_METADATA_STORE].put(settledObserved);
            stores[DURABLE_OUTBOX_STORE].delete(id);
            if (replacement) stores[DURABLE_OUTBOX_STORE].put(replacement);
          };
        };
        return null;
      },
    );
    await loadDurableOutboxOperations();
  });
  if (resolved && settledObserved) observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
  return { resolved, replacement: resolved ? replacement : null };
}

async function enqueueReplacementOutboxOperation(replacementInput, observedValue = {}) {
  const replacement = normalizeDurableOutboxOperation(replacementInput);
  const observed = normalizeObservedGranularMetadata(observedValue);
  if (!replacement || !replacement.operationId) throw new Error("Opération de remplacement invalide.");
  if (typeof indexedDB === "undefined") {
    const records = readOutboxFallback();
    const next = records.filter((entry) => entry.operationId !== replacement.operationId);
    next.push(replacement);
    const currentObserved = await loadSyncMetadata(observed.key);
    const settledObserved = selectMonotonicObservedGranularMetadata(currentObserved, observed);
    await putSyncMetadata(settledObserved.key, settledObserved);
    writeOutboxFallback(next);
    observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
    publishDurableOutboxMirror(next);
    return replacement;
  }
  await runDurableOutboxMutation(async () => {
    await runIndexedDbStoresTransaction(
      [DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE],
      "readwrite",
      (stores) => {
        stores[DURABLE_OUTBOX_STORE].put(replacement);
        const metadataRequest = stores[SYNC_METADATA_STORE].get(observed.key);
        metadataRequest.onsuccess = () => {
          const settledObserved = selectMonotonicObservedGranularMetadata(metadataRequest.result, observed);
          stores[SYNC_METADATA_STORE].put(settledObserved);
        };
      },
    );
    await loadDurableOutboxOperations();
  });
  return replacement;
}

async function settleConflictedOutboxGroupAtomically(operationIds = [], observedValue = {}) {
  const ids = Array.isArray(operationIds) ? operationIds.map(String).filter(Boolean) : [];
  const observed = normalizeObservedGranularMetadata(observedValue);
  if (typeof indexedDB === "undefined") {
    const records = readOutboxFallback();
    const idSet = new Set(ids);
    const next = records.filter((entry) => !idSet.has(entry.operationId));
    const currentObserved = await loadSyncMetadata(observed.key);
    const settledObserved = selectMonotonicObservedGranularMetadata(currentObserved, observed);
    await putSyncMetadata(settledObserved.key, settledObserved);
    writeOutboxFallback(next);
    observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
    publishDurableOutboxMirror(next);
    return { settled: ids, remaining: next };
  }
  let settledObserved = null;
  await runDurableOutboxMutation(async () => {
    await runIndexedDbStoresTransaction(
      [DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE],
      "readwrite",
      (stores) => {
        ids.forEach((id) => stores[DURABLE_OUTBOX_STORE].delete(id));
        const metadataRequest = stores[SYNC_METADATA_STORE].get(observed.key);
        metadataRequest.onsuccess = () => {
          settledObserved = selectMonotonicObservedGranularMetadata(metadataRequest.result, observed);
          stores[SYNC_METADATA_STORE].put(settledObserved);
        };
      },
    );
    await loadDurableOutboxOperations();
  });
  if (settledObserved) observedGranularEntityMetadata.set(settledObserved.key, settledObserved);
  const remaining = await loadDurableOutboxOperations();
  return { settled: ids, remaining };
}

async function updateDurableOutboxOperation(operationId, changes = {}) {
  return runDurableOutboxMutation(async () => {
    const records = await loadDurableOutboxOperations();
    const current = records.find((entry) => entry.operationId === operationId);
    if (!current) return null;
    const updated = normalizeDurableOutboxOperation({
      ...current,
      ...changes,
      operationId,
      updatedAt: new Date().toISOString(),
    });
    const retained = records.filter((entry) => entry.operationId !== operationId);
    retained.push(updated);
    await replaceDurableOutboxOperations(retained);
    return updated;
  });
}

function readDurableOutboxMirror() {
  try {
    const legacyRaw = localStorage.getItem("nimr-sav-offline-queue");
    if (legacyRaw !== null) {
      const legacy = JSON.parse(legacyRaw || "[]");
      return Array.isArray(legacy) ? legacy.map((entry) => ({
        ...entry,
        syncStatus: entry.syncStatus || (entry.status === "success" ? "acknowledged" : entry.status) || "pending",
      })) : [];
    }
    const operations = JSON.parse(localStorage.getItem(DURABLE_OUTBOX_MIRROR_KEY) || "[]");
    return Array.isArray(operations) ? operations : [];
  } catch {
    return [];
  }
}

function getPendingOutboxCount() {
  return readDurableOutboxMirror().filter((entry) => isActiveDurableOutboxSyncStatus(entry.syncStatus)).length;
}

window.estimateStateJsonBytes = estimateStateJsonBytes;
window.shouldPersistStateInIndexedDb = shouldPersistStateInIndexedDb;
window.runIndexedDbStoresTransaction = runIndexedDbStoresTransaction;
window.persistLargeStateSnapshot = persistLargeStateSnapshot;
window.loadLargeStateSnapshot = loadLargeStateSnapshot;
window.removeLargeStateSnapshot = removeLargeStateSnapshot;
window.hydrateLargeStateIfAvailable = hydrateLargeStateIfAvailable;
window.markEntityCaseDirty = markEntityCaseDirty;
window.markEntityCaseDeleted = markEntityCaseDeleted;
window.markEntityBookingDirty = markEntityBookingDirty;
window.markEntityBookingDeleted = markEntityBookingDeleted;
window.markEntityAuditEntryDirty = markEntityAuditEntryDirty;
window.markEntityStateFullReplacement = markEntityStateFullReplacement;
window.markWorkshopSettingsCloudDirty = markWorkshopSettingsCloudDirty;
window.captureEntityMutationBatch = captureEntityMutationBatch;
window.acknowledgeEntityMutationBatch = acknowledgeEntityMutationBatch;
window.buildDurableOperationFromEntityMutation = buildDurableOperationFromEntityMutation;
window.getEntityPersistenceStats = getEntityPersistenceStats;
window.NIMR_ENTITY_PERSISTENCE_TEST_API = Object.freeze({
  buildEntityPersistencePlan,
  commitEntityPersistenceTracker,
  markEntityStateFullReplacement,
});
window.normalizeDurableOutboxOperation = normalizeDurableOutboxOperation;
window.loadDurableOutboxOperations = loadDurableOutboxOperations;
window.putDurableOutboxOperation = putDurableOutboxOperation;
window.deleteDurableOutboxOperation = deleteDurableOutboxOperation;
window.enqueueDurableOutboxOperation = enqueueDurableOutboxOperation;
window.updateDurableOutboxOperation = updateDurableOutboxOperation;
window.acknowledgeDurableOutboxOperation = acknowledgeDurableOutboxOperation;
window.sortDurableOutboxOperationsForSend = sortDurableOutboxOperationsForSend;
window.selectGranularRowsAfterCursor = selectGranularRowsAfterCursor;
window.loadSyncMetadata = loadSyncMetadata;
window.putSyncMetadata = putSyncMetadata;
window.getObservedGranularMetadataKey = getObservedGranularMetadataKey;
window.getObservedGranularEntityMetadata = getObservedGranularEntityMetadata;
window.getObservedGranularServerVersion = getObservedGranularServerVersion;
window.hydrateObservedGranularEntityMetadata = hydrateObservedGranularEntityMetadata;
window.rememberObservedGranularEntityMetadata = rememberObservedGranularEntityMetadata;
window.findActiveDurableOutboxOperationForEntity = findActiveDurableOutboxOperationForEntity;
window.completeDurableOutboxOperationAtomically = completeDurableOutboxOperationAtomically;
window.conflictDurableOutboxOperationAtomically = conflictDurableOutboxOperationAtomically;
window.resolveConflictedOutboxOperationAtomically = resolveConflictedOutboxOperationAtomically;
window.enqueueReplacementOutboxOperation = enqueueReplacementOutboxOperation;
window.settleConflictedOutboxGroupAtomically = settleConflictedOutboxGroupAtomically;

window.getDurableOutboxEquivalenceKey = getDurableOutboxEquivalenceKey;
window.areDurableOutboxOperationsEquivalent = areDurableOutboxOperationsEquivalent;
window.consolidateDurableOutboxOperations = consolidateDurableOutboxOperations;
window.acknowledgeEquivalentDurableOutboxOperations = acknowledgeEquivalentDurableOutboxOperations;
window.readDurableOutboxMirror = readDurableOutboxMirror;
window.getPendingOutboxCount = getPendingOutboxCount;
window.isActiveDurableOutboxSyncStatus = isActiveDurableOutboxSyncStatus;
window.isSendableDurableOutboxSyncStatus = isSendableDurableOutboxSyncStatus;
window.getSyncStateFingerprint = getSyncStateFingerprint;
window.cloneSyncStateSnapshot = cloneSyncStateSnapshot;
window.buildSyncFingerprintState = buildSyncFingerprintState;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compareVersionStrings(left = "", right = "") {
  const leftParts = String(left).replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right).replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function validateBackupPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Fichier de sauvegarde invalide: contenu JSON attendu.");
  }

  const hasBackupEnvelope = Object.prototype.hasOwnProperty.call(payload, "app")
    || Object.prototype.hasOwnProperty.call(payload, "version")
    || Object.prototype.hasOwnProperty.call(payload, "state");

  if (!hasBackupEnvelope) {
    if (!Array.isArray(payload.cases)) {
      throw new Error("Fichier de sauvegarde invalide: liste des dossiers introuvable.");
    }
    return { importedState: payload, photos: [], isLegacy: true, metadata: { appVersion: "ancienne sauvegarde" } };
  }

  if (payload.app !== BACKUP_APP_ID) {
    throw new Error("Fichier refusé: il ne provient pas de NIMR SAV.");
  }
  if (!Number.isFinite(payload.version)) {
    throw new Error("Fichier refusé: version de sauvegarde manquante ou invalide.");
  }
  if (payload.version > BACKUP_FORMAT_VERSION) {
    throw new Error("Fichier refusé: sauvegarde créée avec une version plus récente de l'application.");
  }
  if (payload.appVersion && compareVersionStrings(payload.appVersion, APP_VERSION) > 0) {
    throw new Error(`Fichier refusé: sauvegarde exportée depuis ${payload.appVersion}, plus récent que ${APP_VERSION}.`);
  }
  if (!isPlainObject(payload.state) || !Array.isArray(payload.state.cases)) {
    throw new Error("Fichier de sauvegarde invalide: état applicatif incomplet.");
  }
  for (const key of ["resources", "bookings", "holidays"]) {
    if (payload.state[key] !== undefined && !Array.isArray(payload.state[key])) {
      throw new Error(`Fichier de sauvegarde invalide: ${key} doit être une liste.`);
    }
  }
  if (payload.photos !== undefined && !Array.isArray(payload.photos)) {
    throw new Error("Fichier de sauvegarde invalide: photos doit être une liste.");
  }

  return {
    importedState: payload.state,
    photos: payload.photos || [],
    isLegacy: false,
    metadata: {
      appVersion: payload.appVersion || "version inconnue",
      exportedAt: payload.exportedAt || "date inconnue",
      casesCount: payload.state.cases.length,
      photosCount: Array.isArray(payload.photos) ? payload.photos.length : 0,
      documentsCount: Array.isArray(payload.documents) ? payload.documents.length : 0,
    },
  };
}

async function buildBackupPayload() {
  const caseIds = new Set(state.cases.map((item) => item.id));
  const allPhotos = await getAllPhotoRecords();
  const photos = await Promise.all(
    allPhotos
      .filter((photo) => caseIds.has(photo.caseId))
      .map(async (photo) => ({
        id: photo.id,
        caseId: photo.caseId,
        name: photo.name,
        type: photo.type,
        size: photo.size,
        createdAt: photo.createdAt,
        dataUrl: await blobToDataUrl(photo.blob),
      })),
  );
  const documents = typeof getAllDocumentRecords === "function"
    ? await Promise.all(
        (await getAllDocumentRecords())
          .filter((document) => caseIds.has(document.caseId))
          .map(async (document) => ({
            id: document.id,
            caseId: document.caseId,
            name: document.name,
            type: document.type,
            size: document.size,
            category: document.category,
            createdAt: document.createdAt,
            dataUrl: await blobToDataUrl(document.blob),
          })),
      )
    : [];
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    workshopName: WORKSHOP_NAME,
    exportedAt: new Date().toISOString(),
    warning: "Ce fichier contient des données clients, photos, véhicules, téléphones, VIN, immatriculations et historique.",
    state,
    photos,
    documents,
  };
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function showBackupStatus(message, stateName = "") {
  const target = $("#backup-status");
  if (!target) return;
  target.textContent = message;
  target.dataset.state = stateName;
}

async function confirmStrongSensitiveAction(htmlMessage, expectedText, fallbackMessage = "") {
  if (typeof showPromptModal === "function") {
    return showPromptModal(htmlMessage, expectedText);
  }
  return confirm(fallbackMessage || modalMessageToText(htmlMessage));
}

function formatSensitiveActionAuditDetails(type, payload = {}, actorOverride = null) {
  const actor = actorOverride || (typeof getCurrentActor === "function" ? getCurrentActor() : {});
  const exportedAt = new Date().toISOString();
  const details = [
    `type=${type}`,
    `date=${exportedAt}`,
    `user=${actor.userName || "Atelier"}`,
    `role=${actor.userRole || actor.role || "inconnu"}`,
  ];
  Object.entries(payload).forEach(([key, value]) => {
    details.push(`${key}=${value}`);
  });
  return details.join(" ; ");
}

function formatBackupDate(value) {
  if (!value) return "jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function replaceStateFromImportedBackup(importedState) {
  const previousCases = Array.isArray(state?.cases) ? [...state.cases] : [];
  const previousBookings = Array.isArray(state?.bookings) ? [...state.bookings] : [];
  state = normalizeState(importedState);
  const importedCaseIds = new Set(state.cases.map((item) => String(item?.id || "")).filter(Boolean));
  const importedBookingIds = new Set(state.bookings.map((booking) => String(booking?.id || "")).filter(Boolean));
  previousCases
    .filter((item) => item?.id && !importedCaseIds.has(String(item.id)))
    .forEach((item) => markEntityCaseDeleted(item));
  previousBookings
    .filter((booking) => booking?.id && !importedBookingIds.has(String(booking.id)))
    .forEach((booking) => markEntityBookingDeleted(booking.id));
  markEntityStateFullReplacement();
  return state;
}

if (typeof window !== "undefined") window.replaceStateFromImportedBackup = replaceStateFromImportedBackup;

function getAutosaveHealth() {
  const result = { principal: false, mirror: false, indexedDb: Boolean(window.NIMR_INDEXED_DB_STATUS?.ok), snapshots: 0, lastSavedAt: "", appVersion: APP_VERSION, casesCount: state.cases.length, errors: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    result.principal = !!(parsed && (Array.isArray(parsed.cases) || parsed.largeState === true));
    if (parsed?.largeState) result.indexedDb = true;
  } catch (error) {
    result.errors.push("sauvegarde principale illisible");
  }
  try {
    const raw = localStorage.getItem(STORAGE_MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    result.mirror = !!(parsed?.state && Array.isArray(parsed.state.cases));
    if (parsed?.savedAt) result.lastSavedAt = parsed.savedAt;
    if (parsed?.appVersion) result.appVersion = parsed.appVersion;
  } catch (error) {
    result.errors.push("miroir automatique illisible");
  }
  try {
    const meta = JSON.parse(localStorage.getItem(STORAGE_META_KEY) || "null");
    if (meta?.savedAt && !result.lastSavedAt) result.lastSavedAt = meta.savedAt;
    if (Number.isFinite(meta?.casesCount)) result.casesCount = meta.casesCount;
    if (meta?.largeState) {
      result.indexedDb = true;
      result.mirror = true;
    }
  } catch (error) {
    result.errors.push("métadonnées illisibles");
  }
  try {
    const snapshots = JSON.parse(localStorage.getItem(STORAGE_SNAPSHOTS_KEY) || "[]");
    result.snapshots = Array.isArray(snapshots) ? snapshots.length : 0;
  } catch (error) {
    result.errors.push("snapshots illisibles");
  }
  try {
    const cloudOk = localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave`);
    const cloudError = localStorage.getItem(`${STORAGE_KEY}:last-cloud-autosave-error`);
    result.cloud = cloudOk || "non configuré";
    const okTime = cloudOk ? new Date(cloudOk).getTime() : 0;
    result.cloudError = okTime ? "" : (cloudError || "");
  } catch (error) {
    result.cloud = "non disponible";
  }
  return result;
}

function renderAutosaveHealthStatus() {
  const target = $("#autosave-control-status");
  if (!target) return;
  const health = getAutosaveHealth();
  const ok = health.principal && (health.indexedDb || health.mirror) && !health.errors.length;
  target.dataset.state = ok ? "ok" : "error";
  target.innerHTML = `
    <strong>${ok ? "Sauvegarde automatique OK" : "Contrôle sauvegarde à vérifier"}</strong><br />
    Dernière sauvegarde locale : ${formatBackupDate(health.lastSavedAt)} · Version : ${health.appVersion} · Dossiers : ${health.casesCount}<br />
    Principal : ${health.principal ? "OK" : "manquant"} · Cache IndexedDB : ${health.indexedDb ? "OK (primaire)" : "indisponible"} · Miroir : ${health.mirror ? "OK" : "manquant"} · Points de restauration : ${health.snapshots}<br />
    Cloud auto : ${health.cloud ? formatBackupDate(health.cloud) : "non configuré"}${health.cloudError ? ` · Dernière erreur cloud : ${health.cloudError}` : ""}
    ${health.errors.length ? `<br />Erreurs : ${health.errors.join(", ")}` : ""}
  `;
}

function controlAutosaveHealth() {
  saveState({ skipCloud: true });
  renderAutosaveHealthStatus();
  const health = getAutosaveHealth();
  if (health.principal && (health.indexedDb || health.mirror)) {
    quietNotify("Sauvegarde automatique locale contrôlée avec succès.", "success");
  } else {
    notifyUser("Contrôle sauvegarde incomplet. Exportez une sauvegarde JSON maintenant.", "error");
  }
}

async function exportSafetySnapshotNow() {
  const permissionGuard = guardSensitiveAction("export.backup");
  if (!permissionGuard.ok) return;
  const confirmed = await confirmStrongSensitiveAction(
    `<strong>Copie de sécurité JSON non chiffrée</strong><br><br>` +
      `Ce fichier contient des données sensibles en clair : clients, VIN, immatriculations, téléphones, photos et historique.<br><br>` +
      `Utilisez l'export chiffré pour tout archivage ou transfert. Tapez ${PLAIN_JSON_EXPORT_CONFIRMATION} pour confirmer cette action exceptionnelle.`,
    PLAIN_JSON_EXPORT_CONFIRMATION,
    "Télécharger une copie JSON non chiffrée ?",
  );
  if (!confirmed) {
    showBackupStatus("Copie de sécurité JSON annulée.");
    return;
  }
  showBackupStatus("Préparation de la copie de sécurité...");
  try {
    const payload = await buildBackupPayload();
    downloadJson(payload, `nimr-carrosserie-controle-securite-${todayKey(new Date())}.json`);
    addAuditLog("backup.safety_snapshot.exported", "Copie de sécurité JSON non chiffrée exportée", formatSensitiveActionAuditDetails("safety-json", {
      cases: state.cases.length,
      photos: payload.photos.length,
      documents: payload.documents?.length || 0,
    }));
    saveState({ skipCloud: true, skipSnapshot: true });
    showBackupStatus("Copie de sécurité téléchargée.", "ok");
    renderAutosaveHealthStatus();
  } catch (error) {
    console.error("Copie de sécurité impossible", error);
    showBackupStatus("Copie de sécurité impossible.", "error");
  }
}

async function restoreLatestAutomaticSnapshot() {
  const permissionGuard = guardSensitiveAction("import.backup");
  if (!permissionGuard.ok) return;
  try {
    const snapshots = JSON.parse(localStorage.getItem(STORAGE_SNAPSHOTS_KEY) || "[]");
    if (!Array.isArray(snapshots) || !snapshots.length) {
      notifyUser("Aucun point de restauration automatique disponible.", "error");
      renderAutosaveHealthStatus();
      return;
    }
    const chosen = snapshots.find((snapshot) => snapshot?.state && Array.isArray(snapshot.state.cases));
    if (!chosen) throw new Error("Aucun snapshot valide trouvé.");
    const confirmed = await confirmStrongSensitiveAction(
      `Restaurer le dernier point automatique du ${formatBackupDate(chosen.savedAt)} ?<br><br>` +
        `Cette action remplace l'état local actuel. Une copie JSON de sécurité sera téléchargée avant restauration.<br><br>` +
        `Tapez ${RESTORE_BACKUP_CONFIRMATION} pour confirmer la restauration.`,
      RESTORE_BACKUP_CONFIRMATION,
      "Restaurer le dernier point automatique ?",
    );
    if (!confirmed) return;
    const safetyPayload = await buildBackupPayload();
    downloadJson(safetyPayload, `nimr-carrosserie-avant-restauration-auto-${todayKey(new Date())}.json`);
    const restoreActor = getCurrentActor();
    const previousSelection = typeof captureCaseSelectionIdentity === "function"
      ? captureCaseSelectionIdentity()
      : { id: activeCaseId };
    state = normalizeState(chosen.state);
    if (typeof initializeLastKnownCasesComparable === "function") {
      initializeLastKnownCasesComparable();
    }
    markEntityStateFullReplacement();
    if (typeof reconcileActiveCaseSelection === "function") reconcileActiveCaseSelection(previousSelection);
    else activeCaseId = state.cases[0]?.id ?? null;
    generatedProposals = {};
    addAuditLog("backup.snapshot.restored", "Point de restauration automatique restauré", formatSensitiveActionAuditDetails("restore-automatic-snapshot", {
      snapshotAt: chosen.savedAt || "inconnu",
      cases: state.cases.length,
    }, restoreActor), { actor: restoreActor });
    await saveState({ skipCloud: true, boundedEntityDetection: true, cloudReason: "restore-automatic-snapshot" });
    render();
    showBackupStatus(`Restauration automatique effectuée depuis ${formatBackupDate(chosen.savedAt)}.`, "ok");
    notifyUser("Point de restauration automatique restauré.", "success");
    renderAutosaveHealthStatus();
  } catch (error) {
    console.error("Restauration automatique impossible", error);
    showBackupStatus(error.message || "Restauration automatique impossible.", "error");
    notifyUser(error.message || "Restauration automatique impossible.", "error");
  }
}

function getBackupPasswordFromUser(title, message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "custom-modal-overlay";
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.innerHTML = `
      <form class="custom-modal-content password-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(message)}</p>
        <label>Mot de passe
          <input name="password" type="password" autocomplete="new-password" required minlength="6" />
        </label>
        ${options.confirm ? `<label>Confirmer mot de passe<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" /></label>` : ""}
        <p class="muted" data-password-status></p>
        <div class="custom-modal-actions">
          <button type="button" class="ghost-button" data-password-cancel>Annuler</button>
          <button type="submit" class="primary-button">${escapeHtml(options.confirmLabel || "Valider")}</button>
        </div>
      </form>
    `;
    const form = overlay.querySelector("form");
    const status = overlay.querySelector("[data-password-status]");
    const close = (value) => {
      overlay.remove();
      previousFocus?.focus?.();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-password-cancel]")) close(null);
    });
    form.addEventListener("keydown", (event) => trapFocusWithin(form, event));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const password = form.elements.password.value;
      const confirmPassword = form.elements.confirmPassword?.value;
      if (password.length < 6) {
        status.textContent = "Utilisez au moins 6 caractères.";
        return;
      }
      if (options.confirm && isWeakBackupPassword(password)) {
        status.textContent = "Mot de passe trop faible : utilisez au moins 10 caractères avec lettres et chiffres.";
        return;
      }
      if (options.confirm && password !== confirmPassword) {
        status.textContent = "Les mots de passe ne correspondent pas.";
        return;
      }
      close(password);
    });
    document.body.appendChild(overlay);
    window.setTimeout(() => form.elements.password.focus(), 50);
  });
}

function isWeakBackupPassword(password) {
  const value = String(password || "");
  return value.length < 10 || !/[a-zA-ZÀ-ÿ]/.test(value) || !/\d/.test(value);
}

async function deriveBackupCryptoKey(password, saltBytes, usages) {
  const cryptoApi = getBrowserCrypto();
  if (!cryptoApi) throw new Error("Le chiffrement navigateur n'est pas disponible sur ce poste.");
  const material = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 180000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function encryptBackupPayload(payload, password) {
  const cryptoApi = getBrowserCrypto();
  if (!cryptoApi) throw new Error("Le chiffrement navigateur n'est pas disponible sur ce poste.");
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  cryptoApi.getRandomValues(salt);
  cryptoApi.getRandomValues(iv);
  const key = await deriveBackupCryptoKey(password, salt, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    app: "nimr-sav-encrypted-backup",
    version: 1,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    casesCount: payload?.state?.cases?.length || 0,
    photosCount: Array.isArray(payload?.photos) ? payload.photos.length : 0,
    documentsCount: Array.isArray(payload?.documents) ? payload.documents.length : 0,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 180000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(encrypted),
  };
}

async function decryptBackupPayload(encryptedPayload, password) {
  if (encryptedPayload?.app !== "nimr-sav-encrypted-backup") return encryptedPayload;
  const cryptoApi = getBrowserCrypto();
  if (!cryptoApi) throw new Error("Le chiffrement navigateur n'est pas disponible sur ce poste.");
  const key = await deriveBackupCryptoKey(password, base64ToBytes(encryptedPayload.salt), ["decrypt"]);
  const decrypted = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encryptedPayload.iv) },
    key,
    base64ToBytes(encryptedPayload.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function isEncryptedBackupPayload(payload) {
  return payload?.app === "nimr-sav-encrypted-backup";
}

async function exportBackup() {
  const permissionGuard = guardSensitiveAction("export.backup");
  if (!permissionGuard.ok) return;

  const estimatedSize = estimateBackupSize();
  if (estimatedSize > 15 * 1024 * 1024) {
    const sizeMb = (estimatedSize / (1024 * 1024)).toFixed(1);
    const confirmed = await showConfirmModal(
      `La taille de la sauvegarde est estimée à ${sizeMb} Mo. L'exportation d'un fichier volumineux peut ralentir ou planter votre navigateur. Continuer ?`
    );
    if (!confirmed) {
      showBackupStatus("Export annulé (fichier trop volumineux).");
      return;
    }
  }

  const warningMsg = `<strong>Attention : Exportation non chiffrée (Format JSON)</strong><br><br>` +
    `Ce fichier contient toutes les données personnelles (noms clients, téléphones, VIN, immatriculations, photos, historique) EN CLAIR.<br>` +
    `Transmettre ou stocker ce fichier sans chiffrement présente un risque de sécurité et de conformité RGPD.<br><br>` +
    `Pour archiver ou transférer une sauvegarde, utilisez de préférence <strong>l’export chiffré (.nimrsecure)</strong>.<br><br>` +
    `Action exceptionnelle réservée aux rôles autorisés.<br><br>` +
    `Tapez ${PLAIN_JSON_EXPORT_CONFIRMATION} pour générer l'export JSON non chiffré.`;

  const confirmed = await confirmStrongSensitiveAction(
    warningMsg,
    PLAIN_JSON_EXPORT_CONFIRMATION,
    "Exporter une sauvegarde JSON non chiffrée ? Contient des données sensibles en clair.",
  );

  if (!confirmed) {
    showBackupStatus("Export JSON non chiffré annulé.");
    return;
  }
  showBackupStatus("Préparation de la sauvegarde JSON non chiffrée...");
  try {
    const payload = await buildBackupPayload();
    downloadJson(payload, `nimr-sav-sauvegarde-non-chiffree-${todayKey(new Date())}.json`);
    addAuditLog("backup.exported", "Sauvegarde JSON non chiffrée exportée", formatSensitiveActionAuditDetails("plain-json", {
      cases: state.cases.length,
      photos: payload.photos.length,
      documents: payload.documents?.length || 0,
    }));
    saveState({ skipCloud: true, skipSnapshot: true });
    showBackupStatus(`Sauvegarde JSON non chiffrée exportée: ${state.cases.length} dossier(s), ${payload.photos.length} photo(s). Protégez ce fichier.`, "ok");
    notifyUser("Export JSON non chiffré créé. Protégez ce fichier.", "warn");
  } catch (error) {
    console.error("Export sauvegarde impossible", error);
    showBackupStatus("Export impossible. Vérifiez l'espace disponible du navigateur.", "error");
    notifyUser(error.message || "Impossible d'exporter la sauvegarde.");
  }
}

async function exportEncryptedBackup() {
  const permissionGuard = guardSensitiveAction("export.backup");
  if (!permissionGuard.ok) return;

  const estimatedSize = estimateBackupSize();
  if (estimatedSize > 15 * 1024 * 1024) {
    const sizeMb = (estimatedSize / (1024 * 1024)).toFixed(1);
    const confirmed = await showConfirmModal(
      `La taille de la sauvegarde est estimée à ${sizeMb} Mo. L'exportation d'un fichier volumineux peut ralentir ou planter votre navigateur. Continuer ?`
    );
    if (!confirmed) {
      showBackupStatus("Export annulé (fichier trop volumineux).");
      return;
    }
  }

  showBackupStatus("Préparation de la sauvegarde chiffrée...");
  const password = await getBackupPasswordFromUser(
    "Exporter une sauvegarde chiffrée",
    "Choisissez un mot de passe. Il sera obligatoire pour restaurer ce fichier.",
    { confirm: true, confirmLabel: "Exporter chiffré" },
  );
  if (!password) {
    showBackupStatus("Export chiffré annulé.");
    return;
  }
  try {
    const payload = await buildBackupPayload();
    const encrypted = await encryptBackupPayload(payload, password);
    downloadJson(encrypted, `nimr-sav-sauvegarde-chiffree-${todayKey(new Date())}.nimrsecure`);
    addAuditLog("backup.encrypted.exported", "Sauvegarde chiffrée exportée", formatSensitiveActionAuditDetails("encrypted-backup", {
      cases: state.cases.length,
      photos: payload.photos.length,
      documents: payload.documents?.length || 0,
    }));
    saveState({ skipCloud: true, skipSnapshot: true });
    showBackupStatus(`Sauvegarde chiffrée exportée: ${state.cases.length} dossier(s), ${payload.photos.length} photo(s). Testez-la avant archivage.`, "ok");
    notifyUser("Sauvegarde chiffrée créée. Testez-la avant archivage.", "success");
  } catch (error) {
    console.error("Export chiffré impossible", error);
    showBackupStatus(error.message || "Export chiffré impossible.", "error");
    notifyUser(error.message || "Impossible d'exporter la sauvegarde chiffrée.", "error");
  }
}

async function testEncryptedBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  showBackupStatus("Test de la sauvegarde chiffrée...");
  try {
    const encrypted = JSON.parse(await readFileAsText(file));
    if (!isEncryptedBackupPayload(encrypted)) {
      showBackupStatus("Le fichier sélectionné n'est pas une sauvegarde chiffrée .nimrsecure.", "error");
      return;
    }
    const password = await getBackupPasswordFromUser(
      "Tester une sauvegarde chiffrée",
      "Entrez le mot de passe pour vérifier le fichier sans restaurer les données.",
      { confirmLabel: "Tester" },
    );
    if (!password) {
      showBackupStatus("Test de sauvegarde annulé.");
      return;
    }
    const payload = await decryptBackupPayload(encrypted, password);
    const { importedState, photos, metadata } = validateBackupPayload(payload);
    showBackupStatus(
      `Sauvegarde valide: ${importedState.cases.length} dossier(s), ${photos.length} photo(s), version ${metadata.appVersion || encrypted.appVersion || "inconnue"}. Aucune donnée restaurée.`,
      "ok",
    );
    notifyUser("Sauvegarde chiffrée vérifiée sans restauration.", "success");
  } catch (error) {
    console.error("Test sauvegarde chiffrée impossible", error);
    showBackupStatus(error.message || "Test de sauvegarde chiffrée impossible.", "error");
    notifyUser(error.message || "Mot de passe incorrect ou fichier illisible.", "error");
  } finally {
    event.target.value = "";
  }
}

async function importBackup(event) {
  const permissionGuard = guardSensitiveAction("import.backup");
  if (!permissionGuard.ok) {
    if (event?.target) event.target.value = "";
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_BACKUP_IMPORT_SIZE) {
    showBackupStatus("Import refusé: sauvegarde supérieure à 50 Mo.", "error");
    notifyUser("La sauvegarde dépasse 50 Mo. Importez un fichier plus léger ou fractionnez les photos.", "error");
    event.target.value = "";
    return;
  }
  showBackupStatus("Import de la sauvegarde...");
  try {
    let payload = JSON.parse(await readFileAsText(file));
    if (isEncryptedBackupPayload(payload)) {
      const password = await getBackupPasswordFromUser(
        "Restaurer une sauvegarde chiffrée",
        "Entrez le mot de passe utilisé lors de l'export.",
        { confirmLabel: "Déchiffrer" },
      );
      if (!password) {
        showBackupStatus("Import chiffré annulé.");
        return;
      }
      try {
        payload = await decryptBackupPayload(payload, password);
      } catch (error) {
        throw new Error("Mot de passe incorrect ou sauvegarde chiffrée endommagée.");
      }
    }
    const { importedState, photos, isLegacy, metadata } = validateBackupPayload(payload);
    const documents = Array.isArray(payload.documents) ? payload.documents : [];
    const versionLabel = isLegacy ? "format ancien" : `${metadata.appVersion}, exportée le ${metadata.exportedAt}`;
    const importWarning = `Importer cette sauvegarde (${versionLabel}) remplacera l'intégralité de l'état local actuel (dossiers, planning, paramètres, photos). Une copie de sécurité de l'état actuel sera téléchargée avant remplacement.<br><br>` +
      `<strong>Attention :</strong> Assurez-vous de n'importer que des fichiers de confiance contenant des informations RGPD sensibles (données clients/véhicules).<br><br>` +
      `Tapez ${RESTORE_BACKUP_CONFIRMATION} pour confirmer la restauration.`;

    const confirmed = await confirmStrongSensitiveAction(
      importWarning,
      RESTORE_BACKUP_CONFIRMATION,
      "Importer cette sauvegarde ? Écrase les données locales.",
    );

    if (!confirmed) {
      showBackupStatus("Import annulé.");
      return;
    }

    const safetyPayload = await buildBackupPayload();
    downloadJson(safetyPayload, `nimr-carrosserie-avant-import-${todayKey(new Date())}.json`);

    const importActor = getCurrentActor();
    const previousSelection = typeof captureCaseSelectionIdentity === "function"
      ? captureCaseSelectionIdentity()
      : { id: activeCaseId };
    replaceStateFromImportedBackup(importedState);
    if (typeof reconcileActiveCaseSelection === "function") reconcileActiveCaseSelection(previousSelection);
    else activeCaseId = state.cases[0]?.id ?? null;
    generatedProposals = {};
    
    // Nettoyer à la fois les photos et les documents
    await clearPhotoStore();
    if (typeof clearDocumentStore === "function") {
      await clearDocumentStore();
    }
    
    const restoredPhotos = await restorePhotoRecords(photos);
    const restoredDocuments = typeof restoreDocumentRecords === "function" ? await restoreDocumentRecords(documents) : 0;
    
    // Déclencher le nettoyage des orphelins
    if (typeof cleanupOrphanedStorage === "function") {
      await cleanupOrphanedStorage().catch(() => null);
    }

    addAuditLog("backup.imported", "Sauvegarde importée", formatSensitiveActionAuditDetails("restore-file", {
      cases: importedState.cases.length,
      photos: photos.length,
      documents: restoredDocuments,
      sourceVersion: metadata.appVersion || "inconnue",
    }, importActor), { actor: importActor });
    await saveState({ fullCaseRevisionScan: true, cloudReason: "backup-import" });
    render();
    showBackupStatus(`Sauvegarde importée: ${state.cases.length} dossier(s), ${restoredPhotos} photo(s), ${restoredDocuments} document(s).`, "ok");
  } catch (error) {
    console.error("Import sauvegarde impossible", error);
    addAuditLog("backup.import_failed", "Import sauvegarde refusé ou échoué", error.message || "Sauvegarde invalide.", { actor: getCurrentActor() });
    saveState({ skipCloud: true, skipSnapshot: true });
    showBackupStatus("Import impossible. Le fichier n'est pas une sauvegarde valide.", "error");
    notifyUser(error.message || "Impossible d'importer cette sauvegarde.");
  } finally {
    event.target.value = "";
  }
}

async function handleVehicleFile(event, root, item) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $("#vehicle-import-status", root);
  status.textContent = "Lecture de la base véhicules...";
  try {
    setVehicleRecords(await parseVehicleDatabaseFile(file), "import manuel");
    autoFillVehicleFromCurrentFields(item, root);
  } catch (error) {
    console.error("Import véhicule impossible", error);
    status.textContent = "Import impossible";
    notifyUser(error.message || "Impossible de lire le fichier véhicules.");
  } finally {
    event.target.value = "";
  }
}

async function parseVehicleDatabaseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return parseVehicleRows(parseCsv(await readFileAsText(file)));
  }
  if (!name.endsWith(".xlsx")) {
    throw new Error("Format non supporté. Importez un fichier .xlsx ou .csv.");
  }
  const entries = await unzipXlsx(await readFileAsArrayBuffer(file));
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const sheetPath = [...entries.keys()].find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!sheetPath) throw new Error("Aucune feuille Excel lisible trouvée.");
  return parseVehicleRows(parseWorksheet(entries.get(sheetPath), sharedStrings));
}

async function loadBundledVehicleDatabase() {
  updateVehicleImportStatus("Vérification base véhicules locale...");
  try {
    const response = await fetch(VEHICLE_DATA_URL, { cache: "no-store" });
    if (response.status === 404) {
      clearBundledVehicleDatabase("empty");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = typeof response.text === "function"
      ? await response.text()
      : JSON.stringify(await response.json());
    if (!String(payload || "").trim()) {
      clearBundledVehicleDatabase("empty");
      return;
    }
    const records = JSON.parse(payload);
    if (!Array.isArray(records) || records.length === 0) {
      clearBundledVehicleDatabase("empty");
      return;
    }
    setVehicleRecords(records, "base locale");
  } catch (error) {
    console.warn("Base véhicules locale non chargée", error);
    clearBundledVehicleDatabase("error");
  }
}

function clearBundledVehicleDatabase(reason = "empty") {
  vehicleRecords = [];
  vehicleDatabaseLoaded = false;
  vehicleDatabaseStatus = reason === "error" ? "error" : "empty";
  const message = reason === "error"
    ? "Base véhicules indisponible. Import local CSV/XLSX possible."
    : "Base véhicules publique vide. Import local CSV/XLSX disponible.";
  updateVehicleImportStatus(message);
  renderQuickVinResults();
}

function setVehicleRecords(records, source = "") {
  vehicleRecords = records.map(normalizeVehicleRecord).filter((record) => record.vin || record.plate);
  vehicleDatabaseLoaded = true;
  vehicleDatabaseStatus = "local";
  const label = `${vehicleRecords.length} véhicules chargés${source ? ` (${source})` : ""}`;
  updateVehicleImportStatus(label);
  renderQuickVinResults();
}

function normalizeVehicleRecord(record) {
  return {
    vin: String(record.vin || "").trim(),
    vehicle: String(record.vehicle || "").trim(),
    plate: String(record.plate || "").trim(),
    clientName: String(record.clientName || "").trim(),
    phone: String(record.phone || "").trim(),
    color: String(record.color || "").trim(),
    clientNumber: String(record.clientNumber || "").trim(),
    managementCenter: String(record.managementCenter || "").trim(),
    lotNo: String(record.lotNo || "").trim(),
  };
}

function updateVehicleImportStatus(message) {
  ["#quick-vehicle-import-status", "#vehicle-import-status"].forEach((selector) => {
    const target = $(selector);
    if (target) target.textContent = message;
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function parseVehicleRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const map = {
    vin: findHeader(headers, ["vin", "chassis", "châssis", "no chassis", "n chassis", "numero chassis", "numéro chassis"]),
    vehicle: findHeader(headers, ["description", "vehicule", "véhicule", "modele", "modèle", "voiture"]),
    plate: findHeader(headers, ["matricule", "immatriculation", "immat", "plaque"]),
    clientName: findHeader(headers, ["nom", "client", "nom client", "raison sociale"]),
    phone: findHeader(headers, ["telephone", "téléphone", "tel", "n telephone", "n téléphone"]),
    color: findHeader(headers, ["couleur", "color"]),
  };
  return rows
    .slice(1)
    .map((row) => ({
      vin: valueAt(row, map.vin),
      vehicle: valueAt(row, map.vehicle),
      plate: valueAt(row, map.plate),
      clientName: valueAt(row, map.clientName),
      phone: valueAt(row, map.phone),
      color: valueAt(row, map.color),
    }))
    .filter((record) => record.vin || record.plate);
}

function findHeader(headers, aliases) {
  return headers.findIndex((header) => aliases.some((alias) => header.includes(normalizeHeader(alias))));
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeVehicleKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function applyVehicleLookup(item, root) {
  const query = $("#vehicle-lookup-input", root).value || item.plate || item.vin;
  const record = findVehicleRecord(query);
  if (!record) {
    $("#vehicle-import-status", root).textContent = vehicleRecords.length ? "Aucun véhicule trouvé" : "Importez d'abord la base véhicules";
    return;
  }
  applyVehicleRecord(item, record);
  addHistory(item, "vehicle.lookup", `Véhicule renseigné depuis la base: ${record.plate || record.vin}`);
  saveState({ changedCase: item });
  renderCaseDetail();
}

function autoFillVehicleFromCurrentFields(item, root) {
  if (!vehicleRecords.length) return;
  const record = findVehicleRecord(item.plate) || findVehicleRecord(item.vin);
  if (!record) return;
  applyVehicleRecord(item, record);
  saveState({ changedCase: item });
  updateCaseHeader(root, item);
  syncCaseInputs(root, item);
  renderCases();
  $("#vehicle-import-status", root).textContent = "Véhicule trouvé et renseigné";
}

function findVehicleRecord(query) {
  const key = normalizeVehicleKey(query);
  if (key.length < 3) return null;
  return (
    vehicleRecords.find((record) => normalizeVehicleKey(record.plate) === key || normalizeVehicleKey(record.vin) === key) ||
    vehicleRecords.find((record) => normalizeVehicleKey(record.plate).includes(key) || normalizeVehicleKey(record.vin).includes(key))
  );
}

function applyVehicleRecord(item, record) {
  item.clientName = record.clientName || item.clientName;
  item.phone = record.phone || item.phone;
  item.plate = record.plate || item.plate;
  item.vehicle = record.vehicle || item.vehicle;
  item.color = record.color || item.color;
  item.vin = record.vin || item.vin;
}

async function handleQuickVehicleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $("#quick-vehicle-import-status");
  status.textContent = "Lecture de la base véhicules...";
  try {
    setVehicleRecords(await parseVehicleDatabaseFile(file), "import manuel");
  } catch (error) {
    console.error("Import véhicule impossible", error);
    status.textContent = "Import impossible";
    notifyUser(error.message || "Impossible de lire le fichier véhicules.");
  } finally {
    event.target.value = "";
  }
}

function renderQuickVinResults() {
  const form = $("#case-form");
  const target = $("#quick-vin-results");
  const status = $("#quick-vehicle-import-status");
  if (!form || !target) return;
  const query = getQuickVehicleLookupQuery(form);
  if (!vehicleRecords.length) {
    target.innerHTML = "";
    status.textContent = vehicleDatabaseLoaded
      ? "Base véhicules importée vide."
      : vehicleDatabaseStatus === "error"
        ? "Base véhicules indisponible. Import local CSV/XLSX possible."
        : "Base véhicules publique vide. Import local CSV/XLSX disponible.";
    return;
  }
  if (normalizeVehicleKey(query).length < 1) {
    target.innerHTML = "";
    status.textContent = `${vehicleRecords.length} véhicules chargés`;
    return;
  }
  const matches = findVehicleRecordsByVehicleQuery(query, 12);
  status.textContent = `${matches.length} résultat${matches.length > 1 ? "s" : ""} véhicule`;
  target.innerHTML = matches.length
    ? matches
        .map(
          (record, index) => `
            <button class="vin-result-card" type="button" data-quick-vin-result="${index}">
              <strong>${escapeHtml(record.vin || "VIN non renseigné")}</strong>
              <span>${escapeHtml(record.vehicle || "Véhicule")} · ${escapeHtml(record.plate || "Sans immat.")}</span>
              <span>${escapeHtml(record.clientName || "Client non renseigné")}</span>
              ${matches.length === 1 ? `<span class="tag ok">Résultat unique</span>` : ""}
            </button>
          `,
        )
        .join("")
    : `<div class="empty-inline">Aucun véhicule correspondant.</div>`;

  $$("[data-quick-vin-result]", target).forEach((button) => {
    button.addEventListener("click", () => {
      const record = matches[Number(button.dataset.quickVinResult)];
      fillQuickFormFromVehicle(record);
      target.innerHTML = "";
      status.textContent = `Véhicule importé: ${record.vin || record.plate}`;
    });
  });
}

function getQuickVehicleLookupQuery(form) {
  const plate = form.elements.plate?.value?.trim() || "";
  const vin = form.elements.vin?.value?.trim() || "";
  if (document.activeElement === form.elements.vin && vin) return vin;
  if (document.activeElement === form.elements.plate && plate) return plate;
  return vin || plate;
}

function findVehicleRecordsByVehicleQuery(query, limit = 8) {
  const key = normalizeVehicleKey(query);
  if (!key) return [];
  const scoreRecord = (record) => {
    const vin = normalizeVehicleKey(record.vin);
    const plate = normalizeVehicleKey(record.plate);
    if (vin === key || plate === key) return 0;
    if (vin.startsWith(key)) return 1;
    if (plate.startsWith(key)) return 2;
    if (vin.includes(key)) return 3;
    if (plate.includes(key)) return 4;
    return 99;
  };
  return vehicleRecords
    .map((record, index) => ({ record, index, score: scoreRecord(record) }))
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.record);
}

function findVehicleRecordsByVin(query, limit = 8) {
  const key = normalizeVehicleKey(query);
  if (!key) return [];
  const starts = vehicleRecords.filter((record) => normalizeVehicleKey(record.vin).startsWith(key));
  const includes = vehicleRecords.filter((record) => {
    const vin = normalizeVehicleKey(record.vin);
    return !vin.startsWith(key) && vin.includes(key);
  });
  return [...starts, ...includes].slice(0, limit);
}

function fillQuickFormFromVehicle(record) {
  const form = $("#case-form");
  form.elements.clientName.value = record.clientName || form.elements.clientName.value;
  form.elements.phone.value = record.phone || form.elements.phone.value;
  form.elements.vehicle.value = record.vehicle || form.elements.vehicle.value;
  form.elements.plate.value = record.plate || form.elements.plate.value;
  form.elements.color.value = record.color || form.elements.color.value;
  if (form.elements.mileage) form.elements.mileage.value = record.mileage || form.elements.mileage.value;
  form.elements.vin.value = record.vin || form.elements.vin.value;
}

function syncCaseInputs(root, item) {
  $$("[data-input]", root).forEach((input) => {
    const field = input.dataset.input;
    if (field in item) input.value = item[field] || "";
  });
}

function estimateBackupSize() {
  let totalBytes = 0;
  try {
    totalBytes += JSON.stringify(state).length;
  } catch (e) {
    totalBytes += 1024 * 1024;
  }
  if (Array.isArray(state.cases)) {
    state.cases.forEach((item) => {
      if (Array.isArray(item.photos)) {
        item.photos.forEach((photo) => {
          totalBytes += Number(photo.size || 0);
        });
      }
      if (item.expertEstimate?.sourceFile?.size) {
        totalBytes += Number(item.expertEstimate.sourceFile.size);
      }
      if (Array.isArray(item.claims)) {
        item.claims.forEach((claim) => {
          if (claim.estimate?.sourceFile?.size) {
            totalBytes += Number(claim.estimate.sourceFile.size);
          }
        });
      }
    });
  }
  return Math.round(totalBytes * 1.37);
}

window.estimateBackupSize = estimateBackupSize;
