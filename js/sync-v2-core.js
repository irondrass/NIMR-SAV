(function exposeNimrSyncV2Core(root) {
  "use strict";

  const SYNC_V2_OPERATION_SCHEMA_VERSION = 1;

  const SYNC_V2_DOMAINS = Object.freeze([
    "header",
    "estimate",
    "status",
    "execution",
    "planning",
    "note",
    "photo",
    "audit",
    "settings",
  ]);

  const SYNC_V2_ACTIONS = Object.freeze([
    "patch",
    "append",
    "reserve",
    "soft_delete",
    "restore",
  ]);

  const SYNC_V2_APPEND_ONLY_DOMAINS = new Set([
    "note",
    "photo",
    "audit",
  ]);

  function canonicalizeSyncV2Value(value) {
    if (Array.isArray(value)) {
      return value.map(canonicalizeSyncV2Value);
    }
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = canonicalizeSyncV2Value(value[key]);
          return result;
        }, {});
    }
    return value;
  }

  function stringifySyncV2Canonical(value) {
    return JSON.stringify(canonicalizeSyncV2Value(value));
  }

  function hashSyncV2String(value = "") {
    const input = String(value || "");
    let first = 2166136261;
    let second = 2654435769;

    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second ^= code + index;
      second = Math.imul(second, 2246822519);
    }

    return [
      "v1",
      input.length,
      (first >>> 0).toString(16).padStart(8, "0"),
      (second >>> 0).toString(16).padStart(8, "0"),
    ].join(":");
  }

  function makeSyncV2PayloadHash(payload = {}) {
    return hashSyncV2String(stringifySyncV2Canonical(payload));
  }

  function normalizeSyncV2String(value) {
    return String(value || "").trim();
  }

  function normalizeSyncV2Version(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function normalizeSyncV2Operation(input = {}) {
    const payload = (
      input.payload
      && typeof input.payload === "object"
      && !Array.isArray(input.payload)
    )
      ? canonicalizeSyncV2Value(input.payload)
      : {};

    const operation = {
      schemaVersion: Number(
        input.schemaVersion || SYNC_V2_OPERATION_SCHEMA_VERSION,
      ),
      operationId: normalizeSyncV2String(input.operationId),
      idempotencyKey: normalizeSyncV2String(input.idempotencyKey),
      workshopId: normalizeSyncV2String(input.workshopId),
      deviceId: normalizeSyncV2String(input.deviceId),
      userId: normalizeSyncV2String(input.userId),
      entityType: normalizeSyncV2String(input.entityType),
      entityId: normalizeSyncV2String(input.entityId),
      domain: normalizeSyncV2String(input.domain),
      action: normalizeSyncV2String(input.action),
      expectedVersion: normalizeSyncV2Version(input.expectedVersion),
      payload,
      payloadHash: makeSyncV2PayloadHash(payload),
      createdAt: normalizeSyncV2String(input.createdAt),
    };

    if (!operation.idempotencyKey && operation.operationId) {
      operation.idempotencyKey = buildSyncV2IdempotencyKey(operation);
    }

    return operation;
  }

  function buildSyncV2IdempotencyKey(input = {}) {
    const operation = {
      workshopId: normalizeSyncV2String(input.workshopId),
      domain: normalizeSyncV2String(input.domain),
      entityType: normalizeSyncV2String(input.entityType),
      entityId: normalizeSyncV2String(input.entityId),
      action: normalizeSyncV2String(input.action),
      operationId: normalizeSyncV2String(input.operationId),
    };

    return [
      "nimr-sync-v2",
      operation.workshopId,
      operation.domain,
      operation.entityType,
      operation.entityId,
      operation.action,
      operation.operationId,
    ].join("|");
  }

  function validateSyncV2Operation(input = {}) {
    const operation = normalizeSyncV2Operation(input);
    const errors = [];

    if (
      operation.schemaVersion
      !== SYNC_V2_OPERATION_SCHEMA_VERSION
    ) {
      errors.push("schema_version_unsupported");
    }
    if (!operation.operationId) errors.push("operation_id_required");
    if (!operation.idempotencyKey) errors.push("idempotency_key_required");
    if (!operation.workshopId) errors.push("workshop_id_required");
    if (!operation.entityType) errors.push("entity_type_required");
    if (!operation.entityId) errors.push("entity_id_required");
    if (!SYNC_V2_DOMAINS.includes(operation.domain)) {
      errors.push("domain_invalid");
    }
    if (!SYNC_V2_ACTIONS.includes(operation.action)) {
      errors.push("action_invalid");
    }
    if (
      !SYNC_V2_APPEND_ONLY_DOMAINS.has(operation.domain)
      && operation.expectedVersion === null
    ) {
      errors.push("expected_version_required");
    }
    if (
      SYNC_V2_APPEND_ONLY_DOMAINS.has(operation.domain)
      && operation.action !== "append"
    ) {
      errors.push("append_only_domain_requires_append");
    }
    if (
      operation.entityType === "workshop_state"
      || operation.action === "upsert_snapshot"
      || Object.prototype.hasOwnProperty.call(
        operation.payload,
        "state",
      )
    ) {
      errors.push("global_snapshot_forbidden");
    }
    if (
      operation.action === "patch"
      && (
        !operation.payload.changes
        || typeof operation.payload.changes !== "object"
        || Array.isArray(operation.payload.changes)
      )
    ) {
      errors.push("patch_changes_required");
    }

    return {
      ok: errors.length === 0,
      errors,
      operation,
    };
  }

  function getSyncV2ChangedFields(operation = {}) {
    const normalized = normalizeSyncV2Operation(operation);
    const changes = normalized.payload.changes;
    if (!changes || typeof changes !== "object") return [];
    return Object.keys(changes).sort();
  }

  function areSyncV2OperationsSameTarget(left = {}, right = {}) {
    const a = normalizeSyncV2Operation(left);
    const b = normalizeSyncV2Operation(right);
    return (
      a.workshopId === b.workshopId
      && a.entityType === b.entityType
      && a.entityId === b.entityId
      && a.domain === b.domain
    );
  }

  function canAutoMergeSyncV2Operations(left = {}, right = {}) {
    const a = normalizeSyncV2Operation(left);
    const b = normalizeSyncV2Operation(right);

    if (!areSyncV2OperationsSameTarget(a, b)) return false;

    if (
      SYNC_V2_APPEND_ONLY_DOMAINS.has(a.domain)
      && a.action === "append"
      && b.action === "append"
      && a.operationId !== b.operationId
    ) {
      return true;
    }

    if (a.action !== "patch" || b.action !== "patch") return false;

    const leftFields = new Set(getSyncV2ChangedFields(a));
    return getSyncV2ChangedFields(b).every(
      (field) => !leftFields.has(field),
    );
  }

  function mergeSyncV2Operations(left = {}, right = {}) {
    if (!canAutoMergeSyncV2Operations(left, right)) {
      return {
        ok: false,
        conflict: true,
        code: "manual_conflict_required",
      };
    }

    const a = normalizeSyncV2Operation(left);
    const b = normalizeSyncV2Operation(right);

    if (
      SYNC_V2_APPEND_ONLY_DOMAINS.has(a.domain)
      && a.action === "append"
    ) {
      return {
        ok: true,
        conflict: false,
        strategy: "append_both",
        operations: [a, b],
      };
    }

    const mergedPayload = canonicalizeSyncV2Value({
      ...a.payload,
      ...b.payload,
      changes: {
        ...(a.payload.changes || {}),
        ...(b.payload.changes || {}),
      },
      mergedOperationIds: [
        a.operationId,
        b.operationId,
      ].sort(),
    });

    return {
      ok: true,
      conflict: false,
      strategy: "disjoint_patch",
      operation: normalizeSyncV2Operation({
        ...a,
        operationId: [
          a.operationId,
          b.operationId,
        ].sort().join("+"),
        idempotencyKey: "",
        expectedVersion: Math.min(
          a.expectedVersion,
          b.expectedVersion,
        ),
        payload: mergedPayload,
        createdAt: (
          [a.createdAt, b.createdAt]
            .filter(Boolean)
            .sort()[0]
          || ""
        ),
      }),
    };
  }

  function normalizeSyncV2Acknowledgement(input = {}) {
    const status = normalizeSyncV2String(input.status);
    return {
      acknowledged: Boolean(
        input.acknowledged
        || status === "applied"
        || status === "acknowledged",
      ),
      status: status || "unknown",
      operationId: normalizeSyncV2String(input.operationId),
      idempotencyKey: normalizeSyncV2String(input.idempotencyKey),
      entityType: normalizeSyncV2String(input.entityType),
      entityId: normalizeSyncV2String(input.entityId),
      domain: normalizeSyncV2String(input.domain),
      serverVersion: normalizeSyncV2Version(
        input.serverVersion
        ?? input.actualVersion
        ?? input.version,
      ),
      conflictCode: normalizeSyncV2String(
        input.conflictCode || input.code,
      ),
      serverAcknowledgedAt: normalizeSyncV2String(
        input.serverAcknowledgedAt || input.acknowledgedAt,
      ),
      result: (
        input.result
        && typeof input.result === "object"
      )
        ? canonicalizeSyncV2Value(input.result)
        : {},
    };
  }

  const api = Object.freeze({
    SYNC_V2_OPERATION_SCHEMA_VERSION,
    SYNC_V2_DOMAINS,
    SYNC_V2_ACTIONS,
    canonicalizeSyncV2Value,
    stringifySyncV2Canonical,
    hashSyncV2String,
    makeSyncV2PayloadHash,
    buildSyncV2IdempotencyKey,
    normalizeSyncV2Operation,
    validateSyncV2Operation,
    getSyncV2ChangedFields,
    areSyncV2OperationsSameTarget,
    canAutoMergeSyncV2Operations,
    mergeSyncV2Operations,
    normalizeSyncV2Acknowledgement,
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
