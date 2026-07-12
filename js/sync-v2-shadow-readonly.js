(function exposeNimrSyncV2ShadowReadonly(root) {
  "use strict";

  const SYNC_V2_SHADOW_READONLY_FLAG_KEY =
    "nimr-sav-sync-v2-shadow-readonly-enabled:v1";
  const SYNC_V2_SHADOW_READONLY_STATUS_KEY =
    "nimr-sav-sync-v2-shadow-readonly-status:v1";
  const SYNC_V2_SHADOW_READONLY_INTERVAL_MS = 60000;
  const SYNC_V2_SHADOW_READONLY_MAX_CASES = 25;
  const SYNC_V2_SHADOW_READONLY_COLUMNS = [
    "id",
    "workshop_id",
    "local_id",
    "estimate_number",
    "next_action",
    "status",
    "header_version",
    "status_version",
    "header_updated_at",
    "header_updated_by",
    "status_updated_at",
    "status_updated_by",
    "updated_at",
  ].join(", ");

  let readonlyStateProvider = null;
  let readonlyTimer = null;
  let readonlyInitialTimer = null;
  let readonlyScanTail = Promise.resolve();
  let readonlyScanCursor = 0;

  function cloneReadonlyValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function readReadonlyStorage(key, fallback = "") {
    try {
      if (!root.localStorage) return fallback;
      const value = root.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeReadonlyStorage(key, value) {
    try {
      root.localStorage?.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  function isSyncV2ShadowReadonlyEnabled() {
    return readReadonlyStorage(
      SYNC_V2_SHADOW_READONLY_FLAG_KEY,
      "false",
    ) === "true";
  }

  function makeReadonlyIdentifier(prefix = "readonly") {
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

  function setSyncV2ShadowReadonlyEnabled(enabled) {
    const next = Boolean(enabled);
    writeReadonlyStorage(
      SYNC_V2_SHADOW_READONLY_FLAG_KEY,
      next ? "true" : "false",
    );
    if (!next) {
      stopSyncV2ShadowReadonlyMode(
        "feature-flag-disabled",
      );
    }
    publishSyncV2ShadowReadonlyStatus({
      enabled: next,
      state: next ? "enabled_not_started" : "disabled",
    });
    return next;
  }

  function setSyncV2ShadowReadonlyStateProvider(provider) {
    if (
      provider !== null
      && typeof provider !== "function"
    ) {
      throw new TypeError(
        "Le fournisseur d'état C2 doit être une fonction.",
      );
    }
    readonlyStateProvider = provider;
    return Boolean(readonlyStateProvider);
  }

  function getSyncV2ShadowReadonlyRuntimeState() {
    if (typeof readonlyStateProvider !== "function") {
      return {};
    }
    try {
      const candidate = readonlyStateProvider();
      return candidate && typeof candidate === "object"
        ? candidate
        : {};
    } catch (error) {
      console.warn(
        "Lecture de l'état C2 impossible",
        error,
      );
      return {};
    }
  }

  function normalizeReadonlyString(value) {
    return String(value ?? "").trim();
  }

  function normalizeReadonlyNullableText(value) {
    const normalized = normalizeReadonlyString(value);
    return normalized || null;
  }

  function normalizeReadonlyStatus(value) {
    const normalized = normalizeReadonlyString(value)
      .toLowerCase();
    return normalized || null;
  }

  function normalizeReadonlyVersion(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0
      ? number
      : 0;
  }

  function normalizeReadonlyServerRepairOrder(row = {}) {
    return {
      id: normalizeReadonlyString(row.id),
      workshopId: normalizeReadonlyString(
        row.workshop_id,
      ),
      entityId: normalizeReadonlyString(
        row.local_id || row.id,
      ),
      headerVersion: normalizeReadonlyVersion(
        row.header_version,
      ),
      statusVersion: normalizeReadonlyVersion(
        row.status_version,
      ),
      header: {
        estimate_number: normalizeReadonlyNullableText(
          row.estimate_number,
        ),
        next_action: normalizeReadonlyNullableText(
          row.next_action,
        ),
      },
      status: normalizeReadonlyStatus(row.status),
      headerUpdatedAt: normalizeReadonlyString(
        row.header_updated_at,
      ),
      headerUpdatedBy: normalizeReadonlyString(
        row.header_updated_by,
      ),
      statusUpdatedAt: normalizeReadonlyString(
        row.status_updated_at,
      ),
      statusUpdatedBy: normalizeReadonlyString(
        row.status_updated_by,
      ),
      updatedAt: normalizeReadonlyString(
        row.updated_at,
      ),
    };
  }

  function normalizeReadonlyLocalProjection(
    projection = {},
  ) {
    return {
      caseId: normalizeReadonlyString(
        projection.caseId,
      ),
      entityId: normalizeReadonlyString(
        projection.entityId,
      ),
      headerVersion: normalizeReadonlyVersion(
        projection.headerVersion,
      ),
      statusVersion: normalizeReadonlyVersion(
        projection.statusVersion,
      ),
      header: {
        estimate_number:
          normalizeReadonlyNullableText(
            projection.header?.estimate_number,
          ),
        next_action:
          normalizeReadonlyNullableText(
            projection.header?.next_action,
          ),
      },
      status: normalizeReadonlyStatus(
        projection.status,
      ),
    };
  }

  function compareReadonlyDomain(
    domain,
    localProjection,
    serverProjection,
  ) {
    const fields = domain === "header"
      ? ["estimate_number", "next_action"]
      : ["status"];
    const localValues = domain === "header"
      ? localProjection.header
      : { status: localProjection.status };
    const serverValues = domain === "header"
      ? serverProjection.header
      : { status: serverProjection.status };
    const localVersion = domain === "header"
      ? localProjection.headerVersion
      : localProjection.statusVersion;
    const serverVersion = domain === "header"
      ? serverProjection.headerVersion
      : serverProjection.statusVersion;
    const changedFields = fields.filter(
      (field) => (
        JSON.stringify(localValues[field])
        !== JSON.stringify(serverValues[field])
      ),
    );
    const versionRelation = localVersion === serverVersion
      ? "equal"
      : (
        localVersion > serverVersion
          ? "local_ahead"
          : "server_ahead"
      );

    let verdict = "match";
    if (
      changedFields.length === 0
      && versionRelation !== "equal"
    ) {
      verdict = "value_match_version_drift";
    } else if (
      changedFields.length > 0
      && versionRelation === "equal"
    ) {
      verdict = "same_version_mismatch";
    } else if (
      changedFields.length > 0
      && versionRelation === "local_ahead"
    ) {
      verdict = "local_ahead";
    } else if (
      changedFields.length > 0
      && versionRelation === "server_ahead"
    ) {
      verdict = "server_ahead";
    }

    return {
      domain,
      verdict,
      changedFields,
      versionRelation,
      localVersion,
      serverVersion,
      localValues: cloneReadonlyValue(localValues),
      serverValues: cloneReadonlyValue(serverValues),
    };
  }

  function classifyReadonlyComparison(
    headerComparison,
    statusComparison,
  ) {
    const verdicts = [
      headerComparison.verdict,
      statusComparison.verdict,
    ];
    if (verdicts.every((value) => value === "match")) {
      return { outcome: "match", code: "values_and_versions_match" };
    }
    if (verdicts.includes("same_version_mismatch")) {
      return { outcome: "drift", code: "same_version_mismatch" };
    }
    if (verdicts.includes("server_ahead")) {
      return { outcome: "drift", code: "server_ahead" };
    }
    if (verdicts.includes("local_ahead")) {
      return { outcome: "drift", code: "local_ahead" };
    }
    if (verdicts.includes("value_match_version_drift")) {
      return {
        outcome: "drift",
        code: "value_match_version_drift",
      };
    }
    return { outcome: "drift", code: "domain_drift" };
  }

  function buildSyncV2ShadowReadonlyComparison(
    localProjectionInput,
    serverRow,
  ) {
    const localProjection =
      normalizeReadonlyLocalProjection(
        localProjectionInput,
      );

    if (!serverRow) {
      return {
        outcome: "missing",
        code: "server_row_missing",
        localProjection,
        serverProjection: null,
        domains: {},
      };
    }

    const serverProjection =
      normalizeReadonlyServerRepairOrder(serverRow);
    const header = compareReadonlyDomain(
      "header",
      localProjection,
      serverProjection,
    );
    const status = compareReadonlyDomain(
      "status",
      localProjection,
      serverProjection,
    );
    const classification = classifyReadonlyComparison(
      header,
      status,
    );

    return {
      ...classification,
      localProjection,
      serverProjection,
      domains: { header, status },
    };
  }

  function getReadonlyWorkshopId(options = {}) {
    const provided = normalizeReadonlyString(
      options.workshopId,
    );
    if (provided) return provided;
    if (
      typeof root.getSupabaseWorkshopId
      === "function"
    ) {
      return normalizeReadonlyString(
        root.getSupabaseWorkshopId(),
      );
    }
    return "";
  }

  function getReadonlyClient(options = {}) {
    if (options.client) return options.client;
    if (
      typeof root.getSupabaseClient === "function"
    ) {
      return root.getSupabaseClient();
    }
    return null;
  }

  async function getReadonlyAuthenticatedUser(
    options = {},
  ) {
    if (options.user) return options.user;
    if (
      typeof root.getSupabaseUser === "function"
    ) {
      return root.getSupabaseUser();
    }
    return null;
  }

  function isReadonlyUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(normalizeReadonlyString(value));
  }

  function makeReadonlyError(code, message) {
    const error = new Error(message);
    error.syncV2ReadonlyCode = code;
    return error;
  }

  async function executeReadonlyRepairOrderSelect(
    client,
    workshopId,
    column,
    value,
  ) {
    const result = await client
      .from("repair_orders")
      .select(SYNC_V2_SHADOW_READONLY_COLUMNS)
      .eq("workshop_id", workshopId)
      .eq(column, value)
      .maybeSingle();

    if (result?.error) {
      throw makeReadonlyError(
        "repair_order_select_failed",
        String(
          result.error.message
          || result.error
          || "Lecture repair_orders impossible.",
        ),
      );
    }

    return result?.data || null;
  }

  async function fetchSyncV2ShadowReadonlyServerRow(
    entityId,
    options = {},
  ) {
    if (
      !isSyncV2ShadowReadonlyEnabled()
      && options.allowWhenDisabled !== true
    ) {
      throw makeReadonlyError(
        "readonly_feature_flag_disabled",
        "Le mode C2 lecture seule est désactivé.",
      );
    }

    const normalizedEntityId =
      normalizeReadonlyString(entityId);
    if (!normalizedEntityId) {
      throw makeReadonlyError(
        "entity_id_required",
        "Identifiant dossier obligatoire.",
      );
    }

    const workshopId = getReadonlyWorkshopId(options);
    if (!workshopId) {
      throw makeReadonlyError(
        "workshop_id_required",
        "Identifiant atelier obligatoire.",
      );
    }

    const client = getReadonlyClient(options);
    if (!client) {
      throw makeReadonlyError(
        "supabase_client_unavailable",
        "Client Supabase indisponible.",
      );
    }

    const user = await getReadonlyAuthenticatedUser(
      options,
    );
    if (!user?.id) {
      throw makeReadonlyError(
        "supabase_auth_required",
        "Authentification Supabase requise.",
      );
    }

    let queryCount = 1;
    let row = await executeReadonlyRepairOrderSelect(
      client,
      workshopId,
      "local_id",
      normalizedEntityId,
    );

    if (!row && isReadonlyUuid(normalizedEntityId)) {
      queryCount += 1;
      row = await executeReadonlyRepairOrderSelect(
        client,
        workshopId,
        "id",
        normalizedEntityId,
      );
    }

    return {
      row,
      queryCount,
      workshopId,
      userId: normalizeReadonlyString(user.id),
    };
  }

  function resolveReadonlyLocalCase(
    target = null,
    candidateState =
      getSyncV2ShadowReadonlyRuntimeState(),
  ) {
    if (
      target
      && typeof target === "object"
      && !Array.isArray(target)
    ) {
      return target;
    }

    const cases = Array.isArray(candidateState?.cases)
      ? candidateState.cases
      : [];
    const token = normalizeReadonlyString(target);
    if (!token) return null;

    return cases.find((item) => {
      const projection =
        typeof root.projectSyncV2ShadowCase
          === "function"
          ? root.projectSyncV2ShadowCase(item)
          : {};
      return [
        item?.id,
        item?.localId,
        item?.local_id,
        projection.entityId,
      ].some(
        (value) => (
          normalizeReadonlyString(value) === token
        ),
      );
    }) || null;
  }

  async function recordReadonlyComparisonObservation(
    observation,
  ) {
    if (
      typeof root.recordSyncV2ShadowObservation
      !== "function"
    ) {
      throw makeReadonlyError(
        "shadow_journal_unavailable",
        "Journal IndexedDB shadow indisponible.",
      );
    }

    return root.recordSyncV2ShadowObservation({
      ...observation,
      shadowOnly: true,
      readOnlySelectAttempted:
        observation.readOnlySelectAttempted === true,
      writeAttempted: false,
      rpcAttempted: false,
      outboxAttempted: false,
      globalPullAttempted: false,
    });
  }

  function publishSyncV2ShadowReadonlyStatus(
    changes = {},
  ) {
    const previous =
      root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS || {};
    const enabled =
      isSyncV2ShadowReadonlyEnabled();
    const status = {
      enabled,
      running: Boolean(readonlyTimer),
      state: readonlyTimer
        ? "running"
        : (enabled ? "stopped" : "disabled"),
      stateProviderReady:
        typeof readonlyStateProvider === "function",
      selects: Number(previous.selects || 0),
      comparisons: Number(previous.comparisons || 0),
      matches: Number(previous.matches || 0),
      drifts: Number(previous.drifts || 0),
      missing: Number(previous.missing || 0),
      errors: Number(previous.errors || 0),
      serverWrites: 0,
      rpcCalls: 0,
      legacyOutboxWrites: 0,
      globalPulls: 0,
      lastScanAt: previous.lastScanAt || "",
      lastReason: previous.lastReason || "",
      lastError: previous.lastError || "",
      ...changes,
      updatedAt: new Date().toISOString(),
    };

    root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS =
      status;
    writeReadonlyStorage(
      SYNC_V2_SHADOW_READONLY_STATUS_KEY,
      JSON.stringify(status),
    );
    return status;
  }

  async function compareSyncV2ShadowCaseWithServer(
    target,
    options = {},
  ) {
    if (
      !isSyncV2ShadowReadonlyEnabled()
      && options.allowWhenDisabled !== true
    ) {
      throw makeReadonlyError(
        "readonly_feature_flag_disabled",
        "Le mode C2 lecture seule est désactivé.",
      );
    }

    const item = resolveReadonlyLocalCase(
      target,
      options.state
        || getSyncV2ShadowReadonlyRuntimeState(),
    );
    if (!item) {
      const observation =
        await recordReadonlyComparisonObservation({
          id: makeReadonlyIdentifier(
            "readonly-diagnostic",
          ),
          kind: "server_comparison",
          outcome: "skipped",
          code: "local_case_missing",
          createdAt: new Date().toISOString(),
          readOnlySelectAttempted: false,
          scanReason: options.reason || "manual",
        });
      const previous =
        root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS
        || {};
      publishSyncV2ShadowReadonlyStatus({
        comparisons:
          Number(previous.comparisons || 0) + 1,
        lastReason: options.reason || "manual",
      });
      return observation;
    }

    if (
      typeof root.projectSyncV2ShadowCase
      !== "function"
    ) {
      throw makeReadonlyError(
        "shadow_projection_unavailable",
        "Projection locale Sync V2 indisponible.",
      );
    }

    const localProjection =
      root.projectSyncV2ShadowCase(item);
    const entityId = normalizeReadonlyString(
      localProjection.entityId,
    );
    const createdAt = new Date().toISOString();

    try {
      const serverResult =
        await fetchSyncV2ShadowReadonlyServerRow(
          entityId,
          options,
        );
      const comparison =
        buildSyncV2ShadowReadonlyComparison(
          localProjection,
          serverResult.row,
        );
      const observation =
        await recordReadonlyComparisonObservation({
          id: makeReadonlyIdentifier(
            "readonly-comparison",
          ),
          kind: "server_comparison",
          outcome: comparison.outcome,
          code: comparison.code,
          createdAt,
          caseId: normalizeReadonlyString(item.id),
          entityId,
          workshopId: serverResult.workshopId,
          userId: serverResult.userId,
          queryCount: serverResult.queryCount,
          readOnlySelectAttempted: true,
          table: "repair_orders",
          scanReason: options.reason || "manual",
          comparison,
        });

      const previous =
        root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS
        || {};
      publishSyncV2ShadowReadonlyStatus({
        selects:
          Number(previous.selects || 0)
          + serverResult.queryCount,
        comparisons:
          Number(previous.comparisons || 0) + 1,
        matches:
          Number(previous.matches || 0)
          + (comparison.outcome === "match" ? 1 : 0),
        drifts:
          Number(previous.drifts || 0)
          + (comparison.outcome === "drift" ? 1 : 0),
        missing:
          Number(previous.missing || 0)
          + (comparison.outcome === "missing" ? 1 : 0),
        lastReason: options.reason || "manual",
        lastError: "",
      });

      return observation;
    } catch (error) {
      const code = normalizeReadonlyString(
        error?.syncV2ReadonlyCode,
      ) || "readonly_select_failed";
      const observation =
        await recordReadonlyComparisonObservation({
          id: makeReadonlyIdentifier(
            "readonly-error",
          ),
          kind: "server_comparison",
          outcome: "error",
          code,
          createdAt,
          caseId: normalizeReadonlyString(item.id),
          entityId,
          readOnlySelectAttempted:
            code !== "readonly_feature_flag_disabled",
          table: "repair_orders",
          scanReason: options.reason || "manual",
          error: normalizeReadonlyString(
            error?.message || error,
          ),
        });

      const previous =
        root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS
        || {};
      publishSyncV2ShadowReadonlyStatus({
        comparisons:
          Number(previous.comparisons || 0) + 1,
        errors: Number(previous.errors || 0) + 1,
        lastReason: options.reason || "manual",
        lastError: normalizeReadonlyString(
          error?.message || error,
        ),
      });

      return observation;
    }
  }

  function getReadonlyComparableCases(
    candidateState =
      getSyncV2ShadowReadonlyRuntimeState(),
  ) {
    const cases = Array.isArray(candidateState?.cases)
      ? candidateState.cases
      : [];
    if (
      typeof root.projectSyncV2ShadowCase
      !== "function"
    ) {
      return [];
    }
    return cases.filter((item) => {
      const projection =
        root.projectSyncV2ShadowCase(item);
      return Boolean(
        normalizeReadonlyString(projection.entityId),
      );
    });
  }

  function runSyncV2ShadowReadonlyScan(
    reason = "manual-scan",
    options = {},
  ) {
    const execute = async () => {
      if (!isSyncV2ShadowReadonlyEnabled()) {
        return publishSyncV2ShadowReadonlyStatus({
          running: false,
          state: "disabled",
          lastReason: reason,
        });
      }

      const cases = getReadonlyComparableCases(
        options.state
          || getSyncV2ShadowReadonlyRuntimeState(),
      );
      const limit = Math.max(
        1,
        Math.min(
          SYNC_V2_SHADOW_READONLY_MAX_CASES,
          Number(
            options.limit
            || SYNC_V2_SHADOW_READONLY_MAX_CASES,
          ),
        ),
      );

      if (!cases.length) {
        return publishSyncV2ShadowReadonlyStatus({
          lastScanAt: new Date().toISOString(),
          lastReason: reason,
          state: readonlyTimer
            ? "running"
            : "scan_complete",
          lastScanCases: 0,
        });
      }

      const selected = [];
      for (
        let offset = 0;
        offset < Math.min(limit, cases.length);
        offset += 1
      ) {
        selected.push(
          cases[
            (readonlyScanCursor + offset)
            % cases.length
          ],
        );
      }
      readonlyScanCursor =
        (readonlyScanCursor + selected.length)
        % cases.length;

      const outcomes = [];
      for (const item of selected) {
        outcomes.push(
          await compareSyncV2ShadowCaseWithServer(
            item,
            {
              ...options,
              reason,
            },
          ),
        );
      }

      return publishSyncV2ShadowReadonlyStatus({
        lastScanAt: new Date().toISOString(),
        lastReason: reason,
        state: readonlyTimer
          ? "running"
          : "scan_complete",
        lastScanCases: selected.length,
        lastScanOutcomes: outcomes.reduce(
          (result, entry) => {
            const key = normalizeReadonlyString(
              entry?.outcome,
            ) || "unknown";
            result[key] = Number(result[key] || 0) + 1;
            return result;
          },
          {},
        ),
      });
    };

    const run = readonlyScanTail.then(
      execute,
      execute,
    );
    readonlyScanTail = run.catch(() => null);
    return run;
  }

  function startSyncV2ShadowReadonlyMode() {
    if (!isSyncV2ShadowReadonlyEnabled()) {
      return publishSyncV2ShadowReadonlyStatus({
        running: false,
        state: "disabled",
      });
    }
    if (readonlyTimer) {
      return publishSyncV2ShadowReadonlyStatus({
        running: true,
        state: "running",
      });
    }

    readonlyInitialTimer = root.setTimeout(
      () => {
        readonlyInitialTimer = null;
        runSyncV2ShadowReadonlyScan(
          "readonly-startup",
        ).catch((error) => {
          publishSyncV2ShadowReadonlyStatus({
            state: "error",
            lastError: normalizeReadonlyString(
              error?.message || error,
            ),
          });
        });
      },
      0,
    );

    readonlyTimer = root.setInterval(
      () => {
        runSyncV2ShadowReadonlyScan(
          "readonly-interval",
        ).catch((error) => {
          publishSyncV2ShadowReadonlyStatus({
            state: "error",
            lastError: normalizeReadonlyString(
              error?.message || error,
            ),
          });
        });
      },
      SYNC_V2_SHADOW_READONLY_INTERVAL_MS,
    );

    return publishSyncV2ShadowReadonlyStatus({
      running: true,
      state: "running",
      startedAt: new Date().toISOString(),
      lastError: "",
    });
  }

  function stopSyncV2ShadowReadonlyMode(
    reason = "manual-stop",
  ) {
    if (readonlyInitialTimer !== null) {
      root.clearTimeout(readonlyInitialTimer);
      readonlyInitialTimer = null;
    }
    if (readonlyTimer !== null) {
      root.clearInterval(readonlyTimer);
      readonlyTimer = null;
    }
    return publishSyncV2ShadowReadonlyStatus({
      running: false,
      state: isSyncV2ShadowReadonlyEnabled()
        ? "stopped"
        : "disabled",
      lastReason: reason,
    });
  }

  async function initSyncV2ShadowReadonlyMode(
    stateProvider = null,
  ) {
    if (stateProvider !== null) {
      setSyncV2ShadowReadonlyStateProvider(
        stateProvider,
      );
    }
    publishSyncV2ShadowReadonlyStatus({
      state: isSyncV2ShadowReadonlyEnabled()
        ? "initializing"
        : "disabled",
      stateProviderReady:
        typeof readonlyStateProvider === "function",
    });
    if (!isSyncV2ShadowReadonlyEnabled()) {
      return root.NIMR_SYNC_V2_SHADOW_READONLY_STATUS;
    }
    return startSyncV2ShadowReadonlyMode();
  }

  const api = Object.freeze({
    SYNC_V2_SHADOW_READONLY_FLAG_KEY,
    SYNC_V2_SHADOW_READONLY_COLUMNS,
    isSyncV2ShadowReadonlyEnabled,
    setSyncV2ShadowReadonlyEnabled,
    setSyncV2ShadowReadonlyStateProvider,
    getSyncV2ShadowReadonlyRuntimeState,
    normalizeReadonlyServerRepairOrder,
    normalizeReadonlyLocalProjection,
    compareReadonlyDomain,
    buildSyncV2ShadowReadonlyComparison,
    fetchSyncV2ShadowReadonlyServerRow,
    resolveReadonlyLocalCase,
    compareSyncV2ShadowCaseWithServer,
    runSyncV2ShadowReadonlyScan,
    startSyncV2ShadowReadonlyMode,
    stopSyncV2ShadowReadonlyMode,
    initSyncV2ShadowReadonlyMode,
    publishSyncV2ShadowReadonlyStatus,
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
