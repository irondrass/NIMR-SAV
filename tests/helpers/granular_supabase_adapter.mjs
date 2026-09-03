export function createGranularSupabaseAdapter(options = {}) {
  const calls = [];
  const entities = new Map();
  const repairOrders = new Map();
  const audits = new Map();
  const settings = new Map();
  const receipts = new Map();
  const conflicts = new Map();
  let serverVersion = 0;
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

  function applyCasOperation(operation) {
    const receiptKey = `${operation.workshopId}|${operation.operationId}`;
    const receipt = receipts.get(receiptKey);
    const key = entityKey(operation);
    const current = entities.get(key) || null;
    if (receipt) {
      return {
        status: "idempotent", accepted: true, idempotent: true, conflict: false,
        accepted_version: receipt.version,
        server_version: current?.entity_version ?? null,
        canonical: structuredClone(current),
      };
    }
    const priorConflict = conflicts.get(receiptKey);
    if (priorConflict) {
      const replayCurrent = entities.get(key) || null;
      return structuredClone({
        ...priorConflict,
        idempotent: true,
        server_version: replayCurrent?.entity_version ?? null,
        canonical: replayCurrent,
      });
    }
    const baseMatches = current
      ? operation.baseVersion === current.entity_version
      : operation.baseVersion === null;
    if (!baseMatches) {
      const conflict = {
        status: "conflict", accepted: false, idempotent: false, conflict: true,
        conflict_id: `conflict:${operation.operationId}`,
        base_version: operation.baseVersion,
        local_payload: structuredClone(operation.payload || {}),
        server_payload: structuredClone(current?.payload || {}),
        detected_at: new Date().toISOString(),
        conflict_server_version: current?.entity_version ?? null,
        conflict_canonical: structuredClone(current),
        server_version: current?.entity_version ?? null,
        canonical: structuredClone(current),
      };
      conflicts.set(receiptKey, {
        ...conflict,
        server_version: undefined,
        canonical: undefined,
        entityType: operation.entityType,
        entityId: operation.entityId,
      });
      return structuredClone(conflict);
    }
    serverVersion = Math.max(serverVersion, current?.entity_version || 0) + 1;
    const updatedAt = operation.updatedAt || new Date().toISOString();
    const canonical = {
      workshop_id: operation.workshopId,
      entity_type: operation.entityType,
      entity_id: operation.entityId,
      payload: operation.action === "delete"
        ? structuredClone(operation.payload || {})
        : structuredClone(operation.payload?.entity || {}),
      entity_version: serverVersion,
      last_operation_id: operation.operationId,
      deleted_at: operation.action === "delete" ? updatedAt : null,
      updated_at: updatedAt,
      entityVersion: serverVersion,
      operationId: operation.operationId,
      deleted: operation.action === "delete",
    };
    entities.set(key, canonical);
    receipts.set(receiptKey, { version: serverVersion });
    return {
      status: "accepted", accepted: true, idempotent: false, conflict: false,
      accepted_version: serverVersion,
      server_version: serverVersion, canonical: structuredClone(canonical),
    };
  }

  function applySettingsCasOperation(operation) {
    const receiptKey = `${operation.workshopId}|${operation.operationId}`;
    const current = settings.get(operation.workshopId) || null;
    const receipt = receipts.get(receiptKey);
    if (receipt) {
      return {
        status: "idempotent", accepted: true, idempotent: true, conflict: false,
        accepted_version: receipt.version,
        server_version: current?.entity_version ?? null,
        canonical: structuredClone(current),
      };
    }
    const priorConflict = conflicts.get(receiptKey);
    if (priorConflict) {
      return structuredClone({
        ...priorConflict,
        idempotent: true,
        server_version: current?.entity_version ?? null,
        canonical: current,
      });
    }
    const baseMatches = current
      ? operation.baseVersion === current.entity_version
      : operation.baseVersion === null;
    if (!baseMatches) {
      const conflict = {
        status: "conflict", accepted: false, idempotent: false, conflict: true,
        conflict_id: `conflict:${operation.operationId}`,
        base_version: operation.baseVersion,
        local_payload: structuredClone(operation.payload || {}),
        server_payload: structuredClone(current?.value || {}),
        detected_at: new Date().toISOString(),
        conflict_server_version: current?.entity_version ?? null,
        conflict_canonical: structuredClone(current),
        server_version: current?.entity_version ?? null,
        canonical: structuredClone(current),
      };
      conflicts.set(receiptKey, {
        ...conflict,
        server_version: undefined,
        canonical: undefined,
        entityType: "workshop_settings",
        entityId: "workshop_settings",
      });
      return structuredClone(conflict);
    }
    serverVersion = Math.max(serverVersion, current?.entity_version || 0) + 1;
    const canonical = {
      workshop_id: operation.workshopId,
      setting_key: "workshop_settings",
      value: structuredClone(operation.payload || {}),
      entity_version: serverVersion,
      last_operation_id: operation.operationId,
      updated_at: new Date().toISOString(),
    };
    settings.set(operation.workshopId, canonical);
    receipts.set(receiptKey, { version: serverVersion, entityType: "workshop_settings", entityId: "workshop_settings" });
    return {
      status: "accepted", accepted: true, idempotent: false, conflict: false,
      accepted_version: serverVersion,
      server_version: serverVersion,
      canonical: structuredClone(canonical),
    };
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

  function createSelectQuery(table, columns) {
    const filters = {};
    const ordering = [];
    let orFilter = null;
    let rowLimit = null;
    const selectedRows = () => {
      let rows = [];
      const matchFilter = (row) => Object.entries(filters).every(([column, value]) => {
        if (value === null) return row[column] === null || row[column] === undefined;
        return row[column] === value;
      });
      if (table === "sync_entities") {
        rows = [...entities.values()].filter(matchFilter);
      } else if (table === "app_settings") {
        rows = [...settings.values()].filter(matchFilter);
      } else if (table === "audit_logs") {
        rows = [...audits.values()].filter(matchFilter);
      }
      if (orFilter && (table === "sync_entities" || table === "audit_logs")) {
        const gtMatch = orFilter.match(/updated_at\.gt\.([^,)]+)/);
        const eqMatch = orFilter.match(/updated_at\.eq\.([^,)]+)/);
        const idGtMatch = orFilter.match(/entity_id\.gt\.([^,)]+)/) || orFilter.match(/local_id\.gt\.([^,)]+)/);
        if (gtMatch && eqMatch && idGtMatch) {
          const minUpdatedAt = gtMatch[1];
          const eqUpdatedAt = eqMatch[1];
          const minId = idGtMatch[1];
          rows = rows.filter((r) => {
            const u = String(r.updated_at || "");
            const id = String(r.entity_id || r.local_id || "");
            return u > minUpdatedAt || (u === eqUpdatedAt && id > minId);
          });
        }
      }
      if (ordering.length > 0) {
        rows.sort((a, b) => {
          for (const ord of ordering) {
            const valA = a[ord.column] ?? "";
            const valB = b[ord.column] ?? "";
            const cmp = String(valA).localeCompare(String(valB));
            if (cmp !== 0) return ord.ascending ? cmp : -cmp;
          }
          return 0;
        });
      }
      return rows;
    };
    const execute = (single = false) => {
      recordCall({ table, operation: "select", rows: [], filters, columns, ordering, pagination: rowLimit == null ? null : { pageSize: rowLimit } });
      const rows = selectedRows();
      const limited = rowLimit == null ? rows : rows.slice(0, rowLimit);
      return { data: single ? structuredClone(limited[0] || null) : structuredClone(limited), error: null };
    };
    const query = {
      eq(column, value) { filters[column] = value; return query; },
      is(column, value) { filters[column] = value === null ? null : value; return query; },
      order(column, options = {}) { ordering.push({ column, ascending: options.ascending !== false }); return query; },
      or(expr) { orFilter = expr; return query; },
      limit(value) { rowLimit = Number(value); return query; },
      maybeSingle() { return Promise.resolve(execute(true)); },
      then(resolve, reject) { return Promise.resolve().then(() => execute(false)).then(resolve, reject); },
    };
    return query;
  }

  const client = {
    async rpc(name, args) {
      recordCall({ table: name, operation: "rpc", rows: [args], filters: {}, ordering: [], pagination: null, operationId: args.p_operation_id });
      if (name === "nimr_apply_workshop_settings_v2") {
        return { data: applySettingsCasOperation({ workshopId: args.p_workshop_id, entityType: "workshop_settings", entityId: "workshop_settings", baseVersion: args.p_base_version == null ? null : Number(args.p_base_version), operationId: args.p_operation_id, payload: args.p_payload || {} }), error: null };
      }
      if (name === "nimr_resolve_sync_entity_conflict") return { data: { status: "resolved" }, error: null };
      if (name !== "nimr_apply_sync_entity_v2") return { data: null, error: new Error(`Unsupported RPC: ${name}`) };
      const outcome = applyCasOperation({
        workshopId: args.p_workshop_id,
        entityType: args.p_entity_type,
        entityId: args.p_entity_id,
        baseVersion: args.p_base_version == null ? null : Number(args.p_base_version),
        operationId: args.p_operation_id,
        action: args.p_deleted ? "delete" : "upsert",
        payload: args.p_deleted ? (args.p_payload || {}) : { entity: args.p_payload || {} },
      });
      return { data: outcome, error: null };
    },
    from(table) {
      return {
        select(columns) {
          return createSelectQuery(table, columns);
        },
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
    receipts,
    conflicts,
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
