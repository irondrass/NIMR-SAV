export function createGranularSupabaseAdapter(options = {}) {
  const calls = [];
  const entities = new Map();
  const repairOrders = new Map();
  const audits = new Map();
  const settings = new Map();
  let failure = options.failure || null;
  let projectionFailure = options.projectionFailure || null;

  const entityKey = (operation) => `${operation.workshopId}|${operation.entityType}|${operation.entityId}`;
  const projectionKey = (workshopId, entityId) => `${workshopId}|${entityId}`;
  const recordCall = (call) => {
    calls.push(structuredClone(call));
    if (failure) {
      const current = failure;
      if (failure.once !== false) failure = null;
      const error = new Error(current.message || "Injected adapter failure");
      error.code = current.code || "NETWORK";
      throw error;
    }
  };

  function applyCanonicalOperation(operation) {
    const key = entityKey(operation);
    const current = entities.get(key);
    const version = Math.max(0, Number(operation.entityVersion || 0));
    if (current?.last_operation_id === operation.operationId) return structuredClone(current);
    if (current && current.entity_version > version) return structuredClone(current);
    if (current && current.entity_version === version && current.deleted_at && operation.action !== "delete") {
      return structuredClone(current);
    }
    const updatedAt = operation.updatedAt || new Date().toISOString();
    const canonical = {
      workshop_id: operation.workshopId,
      entity_type: operation.entityType,
      entity_id: operation.entityId,
      payload: operation.action === "delete"
        ? structuredClone(operation.payload || {})
        : structuredClone(operation.payload?.entity || {}),
      entity_version: version,
      last_operation_id: operation.operationId,
      deleted_at: operation.action === "delete" ? updatedAt : null,
      updated_at: updatedAt,
      // Compatibility fields retained for the original adapter assertions.
      entityVersion: version,
      operationId: operation.operationId,
      deleted: operation.action === "delete",
    };
    entities.set(key, canonical);
    return structuredClone(canonical);
  }

  function consumeProjectionFailure() {
    if (!projectionFailure) return null;
    const current = projectionFailure;
    if (projectionFailure.once !== false) projectionFailure = null;
    const error = new Error(current.message || "Injected case projection failure");
    error.code = current.code || "PROJECTION";
    return error;
  }

  function createDeleteQuery(table) {
    const filters = {};
    const query = {
      eq(column, value) {
        filters[column] = value;
        return query;
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          recordCall({ table, operation: "delete", rows: [], filters, ordering: [], pagination: null });
          const injected = table === "repair_orders" ? consumeProjectionFailure() : null;
          if (injected) return { data: null, error: injected };
          if (table === "repair_orders") repairOrders.delete(projectionKey(filters.workshop_id, filters.local_id));
          return { data: null, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  }

  const client = {
    async rpc(name, args) {
      recordCall({ table: name, operation: "rpc", rows: [args], filters: {}, ordering: [], pagination: null, operationId: args.p_operation_id });
      if (name !== "nimr_apply_sync_entity") return { data: null, error: new Error(`Unsupported RPC: ${name}`) };
      const canonical = applyCanonicalOperation({
        workshopId: args.p_workshop_id,
        entityType: args.p_entity_type,
        entityId: args.p_entity_id,
        entityVersion: args.p_entity_version,
        operationId: args.p_operation_id,
        action: args.p_deleted ? "delete" : "upsert",
        payload: args.p_deleted ? (args.p_payload || {}) : { entity: args.p_payload || {} },
      });
      return { data: canonical, error: null };
    },
    from(table) {
      return {
        upsert(rows) {
          return {
            async select() {
              recordCall({ table, operation: "upsert", rows, filters: {}, ordering: [], pagination: null });
              const injected = table === "repair_orders" ? consumeProjectionFailure() : null;
              if (injected) return { data: null, error: injected };
              if (table === "repair_orders") {
                rows.forEach((row) => repairOrders.set(projectionKey(row.workshop_id, row.local_id), structuredClone(row)));
              }
              return {
                data: rows.map((row) => ({ id: `${table}:${row.local_id}`, local_id: row.local_id })),
                error: null,
              };
            },
          };
        },
        delete() {
          return createDeleteQuery(table);
        },
      };
    },
  };

  function send(operation) {
    recordCall({
      table: operation.entityType === "audit" ? "audit_logs" : operation.entityType === "workshop_settings" ? "app_settings" : "sync_entities",
      operation: operation.action,
      rows: [operation.payload],
      filters: { workshop_id: operation.workshopId, entity_type: operation.entityType, entity_id: operation.entityId },
      ordering: [],
      pagination: null,
      operationId: operation.operationId,
    });
    if (operation.entityType === "audit") {
      const key = `${operation.workshopId}|${operation.entityId}`;
      if (!audits.has(key)) audits.set(key, structuredClone(operation.payload.entity));
      return { acknowledged: true, duplicate: calls.filter((call) => call.operationId === operation.operationId).length > 1 };
    }
    if (operation.entityType === "workshop_settings") {
      settings.set(operation.workshopId, structuredClone(operation.payload.entity));
      return { acknowledged: true };
    }
    const previous = entities.get(entityKey(operation));
    const canonical = applyCanonicalOperation(operation);
    return {
      acknowledged: true,
      stale: Boolean(previous && canonical.last_operation_id !== operation.operationId),
      canonical,
    };
  }

  function page(rows, cursor, pageSize) {
    recordCall({
      table: "sync_entities",
      operation: "select",
      rows: [],
      filters: cursor ? { after: cursor } : {},
      ordering: ["updated_at", "entity_id"],
      pagination: { pageSize },
    });
    const sorted = rows.slice().sort((left, right) => (
      String(left.updated_at).localeCompare(String(right.updated_at))
      || String(left.entity_id).localeCompare(String(right.entity_id))
    ));
    const filtered = cursor ? sorted.filter((row) => (
      row.updated_at > cursor.updatedAt
      || (row.updated_at === cursor.updatedAt && row.entity_id > cursor.entityId)
    )) : sorted;
    const selected = filtered.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      rows: selected,
      cursor: last ? { updatedAt: last.updated_at, entityId: last.entity_id } : cursor,
      hasMore: filtered.length > selected.length,
    };
  }

  return {
    calls,
    client,
    entities,
    repairOrders,
    audits,
    settings,
    send,
    page,
    injectFailure(nextFailure) { failure = nextFailure; },
    injectProjectionFailure(nextFailure) { projectionFailure = nextFailure; },
    canonical(workshopId, entityType, entityId) {
      const row = entities.get(`${workshopId}|${entityType}|${entityId}`);
      return row ? structuredClone(row) : null;
    },
    projection(workshopId, localId) {
      const row = repairOrders.get(projectionKey(workshopId, localId));
      return row ? structuredClone(row) : null;
    },
    projectionCount(workshopId) {
      const prefix = `${workshopId}|`;
      return [...repairOrders.keys()].filter((key) => key.startsWith(prefix)).length;
    },
    snapshot() {
      return {
        entities: [...entities.entries()],
        repairOrders: [...repairOrders.entries()],
        audits: [...audits.entries()],
        settings: [...settings.entries()],
      };
    },
  };
}
