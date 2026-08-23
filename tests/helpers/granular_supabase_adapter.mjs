export function createGranularSupabaseAdapter(options = {}) {
  const calls = [];
  const entities = new Map();
  const audits = new Map();
  const settings = new Map();
  let failure = options.failure || null;

  const entityKey = (operation) => `${operation.workshopId}|${operation.entityType}|${operation.entityId}`;
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
    const key = entityKey(operation);
    const current = entities.get(key);
    const version = Number(operation.entityVersion || 0);
    if (current && current.entityVersion > version) return { acknowledged: true, stale: true };
    if (current && current.entityVersion === version && current.deleted && operation.action !== "delete") {
      return { acknowledged: true, stale: true };
    }
    entities.set(key, {
      entityVersion: version,
      deleted: operation.action === "delete",
      payload: operation.action === "delete" ? {} : structuredClone(operation.payload.entity),
      operationId: operation.operationId,
    });
    return { acknowledged: true };
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
    entities,
    audits,
    settings,
    send,
    page,
    injectFailure(nextFailure) { failure = nextFailure; },
    snapshot() {
      return {
        entities: [...entities.entries()],
        audits: [...audits.entries()],
        settings: [...settings.entries()],
      };
    },
  };
}
