(function exposeNimrSyncV2Shadow(root) {
  "use strict";

  const SYNC_V2_SHADOW_FLAG_KEY =
    "nimr-sav-sync-v2-shadow-enabled:v1";
  const SYNC_V2_SHADOW_DEVICE_KEY =
    "nimr-sav-sync-v2-shadow-device:v1";
  const SYNC_V2_SHADOW_STATUS_KEY =
    "nimr-sav-sync-v2-shadow-status:v1";
  const SYNC_V2_SHADOW_DB_NAME =
    "nimr-sav-sync-v2-shadow";
  const SYNC_V2_SHADOW_DB_VERSION = 1;
  const SYNC_V2_SHADOW_OBSERVATION_STORE =
    "observations";
  const SYNC_V2_SHADOW_METADATA_STORE =
    "metadata";
  const SYNC_V2_SHADOW_SCAN_INTERVAL_MS = 1500;
  const SYNC_V2_SHADOW_MAX_OBSERVATIONS = 5000;

  let shadowBaseline = new Map();
  let shadowTimer = null;
  let shadowScanTail = Promise.resolve();
  let shadowStartedAt = "";
  let shadowStateProvider = null;
  let inMemoryObservations = [];

  function cloneShadowValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function readShadowStorage(key, fallback = "") {
    try {
      if (!root.localStorage) return fallback;
      const value = root.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeShadowStorage(key, value) {
    try {
      root.localStorage?.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  function isSyncV2ShadowEnabled() {
    return readShadowStorage(
      SYNC_V2_SHADOW_FLAG_KEY,
      "false",
    ) === "true";
  }

  function makeShadowIdentifier(prefix = "shadow") {
    if (
      root.crypto
      && typeof root.crypto.randomUUID === "function"
    ) {
      return `${prefix}-${root.crypto.randomUUID()}`;
    }
    return [
      prefix,
      Date.now(),
      Math.random().toString(36).slice(2, 12),
    ].join("-");
  }

  function getSyncV2ShadowDeviceId() {
    const existing = readShadowStorage(
      SYNC_V2_SHADOW_DEVICE_KEY,
      "",
    ).trim();
    if (existing) return existing;
    const created = makeShadowIdentifier("shadow-device");
    writeShadowStorage(
      SYNC_V2_SHADOW_DEVICE_KEY,
      created,
    );
    return created;
  }

  function setSyncV2ShadowEnabled(enabled) {
    const next = Boolean(enabled);
    writeShadowStorage(
      SYNC_V2_SHADOW_FLAG_KEY,
      next ? "true" : "false",
    );
    if (!next) {
      stopSyncV2ShadowMode("feature-flag-disabled");
    }
    publishSyncV2ShadowStatus({
      enabled: next,
      state: next ? "enabled_not_started" : "disabled",
    });
    return next;
  }

  function normalizeShadowVersion(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0
      ? number
      : 0;
  }

  function getShadowWorkshopId(context = {}) {
    if (context.workshopId) {
      return String(context.workshopId);
    }
    if (typeof root.getSupabaseWorkshopId === "function") {
      return String(root.getSupabaseWorkshopId() || "");
    }
    return "local-workshop";
  }

  function setSyncV2ShadowStateProvider(provider) {
    if (provider !== null && typeof provider !== "function") {
      throw new TypeError(
        "Le fournisseur d'état shadow doit être une fonction.",
      );
    }
    shadowStateProvider = provider;
    return Boolean(shadowStateProvider);
  }

  function getSyncV2ShadowRuntimeState() {
    if (typeof shadowStateProvider !== "function") return {};
    try {
      const candidate = shadowStateProvider();
      return candidate && typeof candidate === "object"
        ? candidate
        : {};
    } catch (error) {
      console.warn(
        "Lecture de l'état shadow impossible",
        error,
      );
      return {};
    }
  }

  function getShadowUserId(context = {}) {
    if (context.userId) return String(context.userId);
    if (typeof root.getCurrentActor === "function") {
      return String(
        root.getCurrentActor()?.userId || "",
      );
    }
    return String(
      getSyncV2ShadowRuntimeState()?.currentUserId || "",
    );
  }

  function getShadowEntityId(item = {}) {
    if (typeof root.caseSyncLocalId === "function") {
      const value = root.caseSyncLocalId(item);
      if (value) return String(value);
    }
    return String(
      item.localId
      || item.local_id
      || item.id
      || "",
    );
  }

  function getShadowCaseVersion(item = {}, domain) {
    const camelName = `${domain}Version`;
    const snakeName = `${domain}_version`;
    return normalizeShadowVersion(
      item.syncV2Versions?.[domain]
      ?? item[camelName]
      ?? item[snakeName]
      ?? 0,
    );
  }

  function getShadowLegacyStatus(item = {}) {
    if (typeof root.buildRepairStatus === "function") {
      return String(root.buildRepairStatus(item) || "new");
    }

    const flags = item.flags || {};
    if (flags.delivered) return "delivered";
    if (flags.qualityApproved) return "quality_approved";
    if (flags.workCompleted) return "work_completed";
    if (flags.workStarted) return "in_progress";
    if (flags.received) return "received";
    if (
      item.source === "pdf_estimate"
      && item.pdfImportStatus
        === "chief_validation_pending"
    ) {
      return "pdf_chief_validation_pending";
    }
    if (
      item.source === "pdf_estimate"
      && item.pdfImportStatus
        === "ready_for_planning"
    ) {
      return "pdf_ready_for_planning";
    }
    if (flags.clientApproved) return "client_approved";
    if (flags.expertApproved) return "expert_approved";
    if (item.appointmentStatus === "scheduled") {
      return "appointment_scheduled";
    }
    return "new";
  }

  function getShadowHeaderProjection(item = {}) {
    return {
      estimate_number:
        item.estimateNumber
        ?? item.estimate_number
        ?? item.expertEstimate?.number
        ?? null,
      next_action:
        item.nextAction
        ?? item.next_action
        ?? item.nextActionCode
        ?? null,
    };
  }

  function projectSyncV2ShadowCase(item = {}) {
    return {
      caseId: String(item.id || ""),
      entityId: getShadowEntityId(item),
      headerVersion: getShadowCaseVersion(
        item,
        "header",
      ),
      statusVersion: getShadowCaseVersion(
        item,
        "status",
      ),
      header: getShadowHeaderProjection(item),
      status: getShadowLegacyStatus(item),
    };
  }

  function getChangedShadowFields(previous = {}, current = {}) {
    const fields = new Set([
      ...Object.keys(previous || {}),
      ...Object.keys(current || {}),
    ]);
    const changes = {};
    fields.forEach((field) => {
      const before = previous?.[field];
      const after = current?.[field];
      const beforeJson = JSON.stringify(before);
      const afterJson = JSON.stringify(after);
      if (beforeJson !== afterJson) {
        changes[field] = cloneShadowValue(after);
      }
    });
    return changes;
  }

  function buildShadowOperation({
    domain,
    entityId,
    expectedVersion,
    changes,
    context = {},
  }) {
    const operationId = context.operationIdFactory
      ? context.operationIdFactory(domain)
      : makeShadowIdentifier(`shadow-${domain}`);
    const createdAt =
      context.createdAt || new Date().toISOString();
    const rawOperation = {
      schemaVersion: 1,
      operationId,
      workshopId: getShadowWorkshopId(context),
      deviceId:
        context.deviceId
        || getSyncV2ShadowDeviceId(),
      userId: getShadowUserId(context),
      entityType: "repair_order",
      entityId,
      domain,
      action: "patch",
      expectedVersion,
      payload: { changes },
      createdAt,
    };

    if (
      typeof root.normalizeSyncV2Operation
      !== "function"
      || typeof root.validateSyncV2Operation
      !== "function"
    ) {
      return {
        rawOperation,
        operation: rawOperation,
        validation: {
          ok: false,
          errors: ["sync_v2_core_unavailable"],
          operation: rawOperation,
        },
      };
    }

    const operation =
      root.normalizeSyncV2Operation(rawOperation);
    const validation =
      root.validateSyncV2Operation(operation);
    return { rawOperation, operation, validation };
  }

  function buildSyncV2ShadowCandidates(
    previousCase,
    currentCase,
    context = {},
  ) {
    if (!currentCase || typeof currentCase !== "object") {
      return [];
    }

    const previousProjection = previousCase
      ? projectSyncV2ShadowCase(previousCase)
      : null;
    const currentProjection =
      projectSyncV2ShadowCase(currentCase);
    const observations = [];

    if (!currentProjection.entityId) {
      observations.push({
        id: makeShadowIdentifier("shadow-diagnostic"),
        kind: "diagnostic",
        outcome: "skipped",
        code: "entity_id_missing",
        createdAt:
          context.createdAt || new Date().toISOString(),
        caseId: currentProjection.caseId,
        currentProjection,
      });
      return observations;
    }

    const previousHeader =
      previousProjection?.header || {};
    const headerChanges = getChangedShadowFields(
      previousHeader,
      currentProjection.header,
    );
    Object.keys(headerChanges).forEach((field) => {
      if (
        !["estimate_number", "next_action"].includes(
          field,
        )
      ) {
        delete headerChanges[field];
      }
    });

    if (Object.keys(headerChanges).length) {
      const built = buildShadowOperation({
        domain: "header",
        entityId: currentProjection.entityId,
        expectedVersion:
          previousProjection?.headerVersion
          ?? currentProjection.headerVersion,
        changes: headerChanges,
        context,
      });
      observations.push({
        id: built.operation.operationId
          || makeShadowIdentifier("shadow-header"),
        kind: "operation_candidate",
        outcome: built.validation.ok
          ? "valid"
          : "invalid",
        createdAt: built.operation.createdAt,
        caseId: currentProjection.caseId,
        domain: "header",
        operation: built.operation,
        validationErrors: [
          ...(built.validation.errors || []),
        ],
        previousProjection,
        currentProjection,
      });
    }

    const previousStatus =
      previousProjection?.status ?? null;
    if (
      previousStatus !== currentProjection.status
    ) {
      const built = buildShadowOperation({
        domain: "status",
        entityId: currentProjection.entityId,
        expectedVersion:
          previousProjection?.statusVersion
          ?? currentProjection.statusVersion,
        changes: {
          status: currentProjection.status,
        },
        context,
      });
      observations.push({
        id: built.operation.operationId
          || makeShadowIdentifier("shadow-status"),
        kind: "operation_candidate",
        outcome: built.validation.ok
          ? "valid"
          : "invalid",
        createdAt: built.operation.createdAt,
        caseId: currentProjection.caseId,
        domain: "status",
        operation: built.operation,
        validationErrors: [
          ...(built.validation.errors || []),
        ],
        previousProjection,
        currentProjection,
      });
    }

    return observations;
  }

  function snapshotShadowCases(
    candidateState = getSyncV2ShadowRuntimeState(),
  ) {
    const cases = Array.isArray(candidateState?.cases)
      ? candidateState.cases
      : [];
    const snapshot = new Map();
    cases.forEach((item) => {
      const key = String(item?.id || getShadowEntityId(item));
      if (key) snapshot.set(key, cloneShadowValue(item));
    });
    return snapshot;
  }

  function openSyncV2ShadowDatabase() {
    if (!root.indexedDB) {
      return Promise.reject(
        new Error("IndexedDB shadow indisponible."),
      );
    }
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(
        SYNC_V2_SHADOW_DB_NAME,
        SYNC_V2_SHADOW_DB_VERSION,
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (
          !database.objectStoreNames.contains(
            SYNC_V2_SHADOW_OBSERVATION_STORE,
          )
        ) {
          const store = database.createObjectStore(
            SYNC_V2_SHADOW_OBSERVATION_STORE,
            { keyPath: "id" },
          );
          store.createIndex(
            "createdAt",
            "createdAt",
            { unique: false },
          );
          store.createIndex(
            "entityId",
            "operation.entityId",
            { unique: false },
          );
          store.createIndex(
            "domain",
            "domain",
            { unique: false },
          );
          store.createIndex(
            "outcome",
            "outcome",
            { unique: false },
          );
        }
        if (
          !database.objectStoreNames.contains(
            SYNC_V2_SHADOW_METADATA_STORE,
          )
        ) {
          database.createObjectStore(
            SYNC_V2_SHADOW_METADATA_STORE,
            { keyPath: "key" },
          );
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(
        request.error
        || new Error(
          "Ouverture IndexedDB shadow impossible.",
        ),
      );
    });
  }

  function runSyncV2ShadowTransaction(
    storeName,
    mode,
    operation,
  ) {
    return openSyncV2ShadowDatabase()
      .then((database) => new Promise(
        (resolve, reject) => {
          const transaction = database.transaction(
            storeName,
            mode,
          );
          const store =
            transaction.objectStore(storeName);
          let request;
          try {
            request = operation(store);
          } catch (error) {
            database.close();
            reject(error);
            return;
          }
          transaction.oncomplete = () => {
            const result = request?.result;
            database.close();
            resolve(result);
          };
          transaction.onerror = () => {
            const error =
              transaction.error
              || request?.error
              || new Error(
                "Transaction IndexedDB shadow impossible.",
              );
            database.close();
            reject(error);
          };
          transaction.onabort = transaction.onerror;
        },
      ));
  }

  async function trimSyncV2ShadowObservations() {
    if (!root.indexedDB) return;
    const all = await runSyncV2ShadowTransaction(
      SYNC_V2_SHADOW_OBSERVATION_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    const sorted = (all || []).sort(
      (left, right) => String(
        left.createdAt,
      ).localeCompare(String(right.createdAt)),
    );
    const excess = Math.max(
      0,
      sorted.length
        - SYNC_V2_SHADOW_MAX_OBSERVATIONS,
    );
    if (!excess) return;
    const ids = sorted
      .slice(0, excess)
      .map((entry) => entry.id);
    await runSyncV2ShadowTransaction(
      SYNC_V2_SHADOW_OBSERVATION_STORE,
      "readwrite",
      (store) => {
        ids.forEach((id) => store.delete(id));
        return null;
      },
    );
  }

  async function recordSyncV2ShadowObservation(
    observation,
  ) {
    const normalized = cloneShadowValue({
      ...observation,
      recordedAt: new Date().toISOString(),
      shadowOnly: true,
      transportAttempted: false,
    });

    if (!root.indexedDB) {
      inMemoryObservations.push(normalized);
      inMemoryObservations =
        inMemoryObservations.slice(
          -SYNC_V2_SHADOW_MAX_OBSERVATIONS,
        );
      return normalized;
    }

    await runSyncV2ShadowTransaction(
      SYNC_V2_SHADOW_OBSERVATION_STORE,
      "readwrite",
      (store) => store.put(normalized),
    );
    trimSyncV2ShadowObservations().catch(() => null);
    return normalized;
  }

  async function loadSyncV2ShadowObservations(
    limit = 200,
  ) {
    const safeLimit = Math.max(
      1,
      Math.min(
        SYNC_V2_SHADOW_MAX_OBSERVATIONS,
        Number(limit || 200),
      ),
    );

    if (!root.indexedDB) {
      return inMemoryObservations
        .slice(-safeLimit)
        .reverse()
        .map(cloneShadowValue);
    }

    const all = await runSyncV2ShadowTransaction(
      SYNC_V2_SHADOW_OBSERVATION_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    return (all || [])
      .sort(
        (left, right) => String(
          right.createdAt,
        ).localeCompare(String(left.createdAt)),
      )
      .slice(0, safeLimit)
      .map(cloneShadowValue);
  }

  async function clearSyncV2ShadowObservations() {
    inMemoryObservations = [];
    if (!root.indexedDB) return;
    await runSyncV2ShadowTransaction(
      SYNC_V2_SHADOW_OBSERVATION_STORE,
      "readwrite",
      (store) => store.clear(),
    );
  }

  function publishSyncV2ShadowStatus(changes = {}) {
    const previous =
      root.NIMR_SYNC_V2_SHADOW_STATUS || {};
    const status = {
      enabled: isSyncV2ShadowEnabled(),
      running: Boolean(shadowTimer),
      state: shadowTimer
        ? "running"
        : (
          isSyncV2ShadowEnabled()
            ? "stopped"
            : "disabled"
        ),
      startedAt: shadowStartedAt,
      lastScanAt: previous.lastScanAt || "",
      lastReason: previous.lastReason || "",
      candidates: Number(previous.candidates || 0),
      valid: Number(previous.valid || 0),
      invalid: Number(previous.invalid || 0),
      skipped: Number(previous.skipped || 0),
      transportAttempts: 0,
      supabaseWrites: 0,
      legacyOutboxWrites: 0,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    root.NIMR_SYNC_V2_SHADOW_STATUS = status;
    writeShadowStorage(
      SYNC_V2_SHADOW_STATUS_KEY,
      JSON.stringify(status),
    );
    return status;
  }

  function runSyncV2ShadowScan(reason = "interval") {
    const execute = async () => {
      if (!isSyncV2ShadowEnabled()) {
        return publishSyncV2ShadowStatus({
          running: false,
          state: "disabled",
          lastReason: reason,
        });
      }

      const current = snapshotShadowCases();
      const observations = [];

      current.forEach((currentCase, key) => {
        const previousCase =
          shadowBaseline.get(key) || null;
        observations.push(
          ...buildSyncV2ShadowCandidates(
            previousCase,
            currentCase,
            { scanReason: reason },
          ),
        );
      });

      shadowBaseline.forEach(
        (previousCase, key) => {
          if (current.has(key)) return;
          observations.push({
            id: makeShadowIdentifier(
              "shadow-diagnostic",
            ),
            kind: "diagnostic",
            outcome: "skipped",
            code: "case_missing_soft_delete_not_active",
            createdAt: new Date().toISOString(),
            caseId: String(previousCase?.id || key),
            previousProjection:
              projectSyncV2ShadowCase(previousCase),
            shadowOnly: true,
          });
        },
      );

      for (const observation of observations) {
        await recordSyncV2ShadowObservation({
          ...observation,
          scanReason: reason,
        });
      }

      shadowBaseline = current;
      const valid = observations.filter(
        (entry) => entry.outcome === "valid",
      ).length;
      const invalid = observations.filter(
        (entry) => entry.outcome === "invalid",
      ).length;
      const skipped = observations.filter(
        (entry) => entry.outcome === "skipped",
      ).length;
      const previous =
        root.NIMR_SYNC_V2_SHADOW_STATUS || {};
      return publishSyncV2ShadowStatus({
        running: Boolean(shadowTimer),
        state: shadowTimer
          ? "running"
          : "scan_complete",
        lastScanAt: new Date().toISOString(),
        lastReason: reason,
        candidates:
          Number(previous.candidates || 0)
          + observations.length,
        valid:
          Number(previous.valid || 0) + valid,
        invalid:
          Number(previous.invalid || 0) + invalid,
        skipped:
          Number(previous.skipped || 0) + skipped,
      });
    };

    const run = shadowScanTail.then(
      execute,
      execute,
    );
    shadowScanTail = run.catch(() => null);
    return run;
  }

  function startSyncV2ShadowMode() {
    if (!isSyncV2ShadowEnabled()) {
      return publishSyncV2ShadowStatus({
        running: false,
        state: "disabled",
      });
    }
    if (shadowTimer) {
      return publishSyncV2ShadowStatus({
        running: true,
        state: "running",
      });
    }

    shadowBaseline = snapshotShadowCases();
    shadowStartedAt = new Date().toISOString();
    shadowTimer = root.setInterval(
      () => {
        runSyncV2ShadowScan("interval")
          .catch((error) => {
            publishSyncV2ShadowStatus({
              state: "error",
              lastError: String(
                error?.message || error,
              ),
            });
          });
      },
      SYNC_V2_SHADOW_SCAN_INTERVAL_MS,
    );

    return publishSyncV2ShadowStatus({
      running: true,
      state: "running",
      startedAt: shadowStartedAt,
      baselineCases: shadowBaseline.size,
      lastError: "",
    });
  }

  function stopSyncV2ShadowMode(
    reason = "manual-stop",
  ) {
    if (shadowTimer) {
      root.clearInterval(shadowTimer);
      shadowTimer = null;
    }
    return publishSyncV2ShadowStatus({
      running: false,
      state: isSyncV2ShadowEnabled()
        ? "stopped"
        : "disabled",
      lastReason: reason,
    });
  }

  async function initSyncV2ShadowMode(
    stateProvider = null,
  ) {
    if (stateProvider !== null) {
      setSyncV2ShadowStateProvider(stateProvider);
    }
    publishSyncV2ShadowStatus({
      state: isSyncV2ShadowEnabled()
        ? "initializing"
        : "disabled",
      stateProviderReady:
        typeof shadowStateProvider === "function",
    });
    if (!isSyncV2ShadowEnabled()) {
      return root.NIMR_SYNC_V2_SHADOW_STATUS;
    }
    return startSyncV2ShadowMode();
  }

  const api = Object.freeze({
    SYNC_V2_SHADOW_FLAG_KEY,
    SYNC_V2_SHADOW_DB_NAME,
    SYNC_V2_SHADOW_OBSERVATION_STORE,
    SYNC_V2_SHADOW_METADATA_STORE,
    isSyncV2ShadowEnabled,
    setSyncV2ShadowEnabled,
    getSyncV2ShadowDeviceId,
    setSyncV2ShadowStateProvider,
    getSyncV2ShadowRuntimeState,
    projectSyncV2ShadowCase,
    getChangedShadowFields,
    buildSyncV2ShadowCandidates,
    initSyncV2ShadowMode,
    startSyncV2ShadowMode,
    stopSyncV2ShadowMode,
    runSyncV2ShadowScan,
    recordSyncV2ShadowObservation,
    loadSyncV2ShadowObservations,
    clearSyncV2ShadowObservations,
    publishSyncV2ShadowStatus,
  });

  Object.assign(root, api);

  if (
    typeof module !== "undefined"
    && module.exports
  ) {
    module.exports = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : window,
);
