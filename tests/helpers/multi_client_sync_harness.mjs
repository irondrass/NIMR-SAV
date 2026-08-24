const clone = (value) => value === undefined ? undefined : structuredClone(value);
const entityKey = (workshopId, entityType, entityId) => `${workshopId}\u0000${entityType}\u0000${entityId}`;
const projectionKey = (workshopId, localId) => `${workshopId}\u0000${localId}`;
const operationKey = (workshopId, operationId) => `${workshopId}\u0000${operationId}`;

function token(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 120);
}

export function caseSyncLocalIdForHarness(item = {}) {
  if (token(item.orNavNumber)) return `case-or:${token(item.orNavNumber)}`;
  if (token(item.vin)) return `case-vin:${token(item.vin)}`;
  const plate = token(item.plate);
  const client = token(item.clientName);
  if (plate || client) return `case:${plate || "no-plate"}:${client || "no-client"}`;
  return item.id;
}

export function makeHarnessCase(overrides = {}) {
  return {
    id: "case-X", orNavNumber: "OR-90001", clientName: "Client X",
    nextAction: "X0", localRevision: 0, updatedAt: "2023-11-14T22:13:20.000Z",
    history: [], claims: [], notes: {}, durations: {}, ...clone(overrides),
  };
}

export function makeHarnessBooking(overrides = {}) {
  return {
    id: "booking-Y", caseId: "case-X", start: "2026-08-24T08:00:00.000Z",
    end: "2026-08-24T09:00:00.000Z", segments: [], resourceIds: ["resource-1"],
    status: "planned", localRevision: 0, updatedAt: "2023-11-14T22:13:20.000Z",
    ...clone(overrides),
  };
}

function rank(operation) {
  if (operation.action === "delete") return operation.entityType === "booking" ? 40 : 50;
  return { case: 10, booking: 20, workshop_settings: 30, audit: 35 }[operation.entityType] || 70;
}

class ModelDServer {
  constructor(harness, timeMs) {
    this.harness = harness;
    this.timeMs = timeMs;
    this.sequence = 0;
    this.entities = new Map();
    this.projections = new Map();
    this.settings = new Map();
    this.audits = new Map();
    this.receipts = new Map();
    this.conflicts = new Map();
    this.conflictCounter = 0;
    this.realtimeQueues = new Map();
    this.delayedResponses = new Map();
    this.nextProjectionFailure = null;
    this.applyLog = [];
  }

  registerClient(client) {
    if (!this.realtimeQueues.has(client.name)) this.realtimeQueues.set(client.name, []);
  }

  nowIso() { this.timeMs += 1; return new Date(this.timeMs).toISOString(); }
  nextVersion() { this.sequence += 1; return this.sequence; }
  canonical(workshopId, entityType, entityId) { return clone(this.entities.get(entityKey(workshopId, entityType, entityId)) || null); }
  projection(workshopId, localId) { return clone(this.projections.get(projectionKey(workshopId, localId)) || null); }
  projectionCount(workshopId) { return [...this.projections.keys()].filter((key) => key.startsWith(`${workshopId}\u0000`)).length; }
  openConflicts(workshopId) { return [...this.conflicts.values()].filter((row) => row.workshop_id === workshopId && row.status === "open").map(clone); }

  seedEntity({ workshopId = "workshop-1", entityType = "case", entityId, payload, entityVersion, deletedAt = null, operationId = "seed", updatedAt, broadcast = false }) {
    this.sequence = Math.max(this.sequence, Number(entityVersion || 0));
    const row = {
      workshop_id: workshopId, entity_type: entityType, entity_id: entityId,
      payload: clone(payload || {}), entity_version: Number(entityVersion || 0),
      last_operation_id: operationId, deleted_at: deletedAt, updated_at: updatedAt || this.nowIso(),
    };
    this.entities.set(entityKey(workshopId, entityType, entityId), row);
    if (entityType === "case") this.reconcileProjection(row);
    if (broadcast) this.broadcast(row);
    return clone(row);
  }

  forceCanonical(input) { return this.seedEntity({ ...input, broadcast: true }); }
  injectRealtime(clientName, row) { this.realtimeQueues.get(clientName)?.push(clone(row)); }
  broadcast(row) { for (const client of this.harness.clients.values()) this.injectRealtime(client.name, row); }
  clearRealtime(clientName) { this.realtimeQueues.set(clientName, []); }
  deliverRealtime(clientName, { order = null } = {}) {
    const client = this.harness.clients.get(clientName);
    if (!client?.online) return 0;
    const queue = this.realtimeQueues.get(clientName) || [];
    const rows = order ? order.map((index) => queue[index]).filter(Boolean) : queue.slice();
    this.realtimeQueues.set(clientName, []);
    rows.forEach((row) => client.applyRemoteEntityRow(row));
    return rows.length;
  }

  conflict(operation, current, reason) {
    const key = operationKey(operation.workshopId, operation.operationId);
    const existing = this.conflicts.get(key);
    if (existing) return { status: "conflict", accepted: false, idempotent: true, conflict: true, conflictId: existing.id, serverVersion: existing.server_version, canonical: clone(existing.canonical) };
    const row = {
      id: `conflict-${++this.conflictCounter}`, workshop_id: operation.workshopId,
      entity_type: operation.entityType, entity_id: operation.entityId,
      base_version: operation.baseVersion, server_version: current?.entity_version ?? null,
      local_operation_id: operation.operationId, action: operation.action,
      local_payload: clone(operation.payload || {}), server_payload: clone(current?.payload || {}),
      canonical: clone(current || null), reason, status: "open", detected_at: this.nowIso(),
    };
    this.conflicts.set(key, row);
    return { status: "conflict", accepted: false, idempotent: false, conflict: true, conflictId: row.id, serverVersion: row.server_version, canonical: clone(current || null) };
  }

  legacyApply() { throw new Error("client upgrade required: CAS baseVersion required"); }

  applyEntity(operation) {
    const opKey = operationKey(operation.workshopId, operation.operationId);
    const receipt = this.receipts.get(opKey);
    if (receipt) {
      const current = this.canonical(operation.workshopId, receipt.entityType, receipt.entityId);
      return {
        status: "idempotent", accepted: true, idempotent: true, conflict: false,
        acceptedVersion: receipt.version, serverVersion: current?.entity_version ?? null,
        canonical: current,
      };
    }
    if (this.conflicts.has(opKey)) return this.conflict(operation, null, "idempotent-conflict");
    const key = entityKey(operation.workshopId, operation.entityType, operation.entityId);
    const current = this.entities.get(key) || null;
    const baseMatches = current ? operation.baseVersion === current.entity_version : operation.baseVersion === null;
    if (!baseMatches) return this.conflict(operation, current, "base-version-mismatch");
    if (operation.entityType === "booking" && operation.action !== "delete") {
      const parentId = operation.payload?.entity?.caseId;
      const parent = this.entities.get(entityKey(operation.workshopId, "case", parentId));
      if (!parent || parent.deleted_at) return this.conflict(operation, current, "inactive-parent-case");
    }
    const version = this.nextVersion();
    const updatedAt = this.nowIso();
    const row = {
      workshop_id: operation.workshopId, entity_type: operation.entityType, entity_id: operation.entityId,
      payload: operation.action === "delete"
        ? (operation.entityType === "case" && operation.payload?.projectionLocalId ? { projectionLocalId: operation.payload.projectionLocalId } : {})
        : clone(operation.payload?.entity || {}),
      entity_version: version, last_operation_id: operation.operationId,
      deleted_at: operation.action === "delete" ? updatedAt : null, updated_at: updatedAt,
    };
    this.entities.set(key, row);
    this.receipts.set(opKey, { entityType: operation.entityType, entityId: operation.entityId, version });
    if (operation.entityType === "case") this.reconcileProjection(row);
    this.broadcast(row);
    if (operation.entityType === "case" && operation.action === "delete") {
      const children = [...this.entities.values()].filter((entry) => entry.workshop_id === operation.workshopId
        && entry.entity_type === "booking" && !entry.deleted_at && entry.payload?.caseId === operation.entityId)
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
      for (const child of children) {
        const childVersion = this.nextVersion();
        const tombstone = { ...child, payload: {}, entity_version: childVersion,
          last_operation_id: `${operation.operationId}:cascade-booking:${child.entity_id}`,
          deleted_at: updatedAt, updated_at: updatedAt };
        this.entities.set(entityKey(child.workshop_id, "booking", child.entity_id), tombstone);
        this.broadcast(tombstone);
      }
    }
    this.applyLog.push({ operationId: operation.operationId, accepted: true, version });
    return { status: "accepted", accepted: true, idempotent: false, conflict: false, acceptedVersion: version, serverVersion: version, canonical: clone(row) };
  }

  applySettings(operation) {
    const opKey = operationKey(operation.workshopId, operation.operationId);
    const receipt = this.receipts.get(opKey);
    if (receipt) {
      const current = this.settings.get(operation.workshopId) || null;
      return {
        status: "idempotent", accepted: true, idempotent: true, conflict: false,
        acceptedVersion: receipt.version, serverVersion: current?.entity_version ?? null,
        canonical: clone(current),
      };
    }
    if (this.conflicts.has(opKey)) return this.conflict(operation, null, "idempotent-conflict");
    const current = this.settings.get(operation.workshopId) || null;
    if ((current && operation.baseVersion !== current.entity_version) || (!current && operation.baseVersion !== null)) return this.conflict(operation, current ? {
      workshop_id: current.workshop_id, entity_type: "workshop_settings", entity_id: "workshop_settings",
      payload: current.value, entity_version: current.entity_version, last_operation_id: current.last_operation_id,
      deleted_at: null, updated_at: current.updated_at,
    } : null, "settings-base-mismatch");
    const version = this.nextVersion();
    const row = { workshop_id: operation.workshopId, setting_key: "workshop_settings",
      value: clone(operation.payload?.entity || {}), entity_version: version,
      last_operation_id: operation.operationId, updated_at: this.nowIso() };
    this.settings.set(operation.workshopId, row);
    this.receipts.set(opKey, { entityType: "workshop_settings", entityId: "workshop_settings", version });
    return { status: "accepted", accepted: true, idempotent: false, conflict: false, acceptedVersion: version, serverVersion: version, canonical: clone(row) };
  }

  reconcileProjection(canonical) {
    if (this.nextProjectionFailure) { const error = this.nextProjectionFailure; this.nextProjectionFailure = null; throw error; }
    if (canonical.deleted_at) {
      this.projections.delete(projectionKey(canonical.workshop_id, canonical.payload?.projectionLocalId || canonical.entity_id));
      return;
    }
    const item = { ...canonical.payload, id: canonical.entity_id };
    const localId = caseSyncLocalIdForHarness(item);
    this.projections.set(projectionKey(canonical.workshop_id, localId), {
      workshop_id: canonical.workshop_id, local_id: localId, entity_id: canonical.entity_id,
      next_action: item.nextAction || null, canonical_version: canonical.entity_version,
    });
  }

  failNextProjection(error = new Error("Injected projection failure")) { this.nextProjectionFailure = error; }
  applyAudit(operation) {
    const key = operationKey(operation.workshopId, operation.entityId);
    const inserted = !this.audits.has(key);
    if (inserted) this.audits.set(key, clone(operation.payload.entity));
    return { inserted };
  }
  pollRows(workshopId, entityType, cursor = null) {
    const rows = [...this.entities.values()].filter((row) => row.workshop_id === workshopId && row.entity_type === entityType)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.entity_id.localeCompare(b.entity_id));
    if (!cursor) return clone(rows);
    return clone(rows.filter((row) => row.updated_at > cursor.updatedAt || (row.updated_at === cursor.updatedAt && row.entity_id > cursor.entityId)));
  }
  releaseResponse(clientName, operationId) {
    const delayed = this.delayedResponses.get(`${clientName}\u0000${operationId}`);
    if (!delayed) throw new Error("Delayed response not found");
    this.delayedResponses.delete(`${clientName}\u0000${operationId}`);
    return this.harness.clients.get(clientName)._settle(delayed.operation, delayed.outcome);
  }
  release(kind, clientName, operationId) {
    if (kind === "response") return this.releaseResponse(clientName, operationId);
    if (kind === "realtime") return this.deliverRealtime(clientName);
    throw new Error(`Unsupported release: ${kind}`);
  }
}

class ModelDClient {
  constructor(harness, name, { workshopId = "workshop-1", clockMs, persisted = null } = {}) {
    this.harness = harness; this.server = harness.server; this.name = name; this.workshopId = workshopId;
    this.clockMs = Number(clockMs ?? harness.baseTimeMs); this.online = true; this.operationCounter = 0;
    this.state = { cases: new Map(), bookings: new Map(), settings: {}, auditLog: new Map() };
    this.outbox = []; this.observed = new Map(); this.syncMetadata = { case: null, booking: null };
    this.syncConflicts = []; this.suspiciousRealtime = []; this.failNextAtomicSettlement = false;
    if (persisted) this.restore(persisted);
    this.persist();
  }
  restore(p) {
    this.state.cases = new Map((p.state.cases || []).map((v) => [v.id, clone(v)]));
    this.state.bookings = new Map((p.state.bookings || []).map((v) => [v.id, clone(v)]));
    this.state.settings = clone(p.state.settings || {}); this.state.auditLog = new Map((p.state.auditLog || []).map((v) => [v.id, clone(v)]));
    this.outbox = clone(p.outbox || []); this.observed = new Map(p.observed || []);
    this.syncMetadata = clone(p.syncMetadata); this.syncConflicts = clone(p.syncConflicts || []); this.operationCounter = p.operationCounter || 0;
  }
  persist() { this.persisted = { state: { cases: [...this.state.cases.values()].map(clone), bookings: [...this.state.bookings.values()].map(clone), settings: clone(this.state.settings), auditLog: [...this.state.auditLog.values()].map(clone) }, outbox: clone(this.outbox), observed: [...this.observed.entries()].map(clone), syncMetadata: clone(this.syncMetadata), syncConflicts: clone(this.syncConflicts), operationCounter: this.operationCounter }; }
  persistedSnapshot() { return clone(this.persisted); }
  setClock(value) { this.clockMs = Number(value); return this; }
  offline() { this.online = false; return this; }
  onlineNow() { this.online = true; return this; }
  nowIso() { return new Date(this.clockMs).toISOString(); }
  observedKey(type, id) { return entityKey(this.workshopId, type, id); }
  base(type, id) { return this.observed.get(this.observedKey(type, id))?.serverVersion ?? null; }
  remember(row, type = row?.entity_type, id = row?.entity_id) {
    if (!type || !id) return;
    const key = this.observedKey(type, id);
    const incoming = { serverVersion: row?.entity_version ?? null, lastOperationId: row?.last_operation_id || "", deleted: Boolean(row?.deleted_at), updatedAt: row?.updated_at || this.nowIso() };
    const current = this.observed.get(key);
    if (current?.serverVersion != null && (incoming.serverVersion == null || incoming.serverVersion < current.serverVersion)) return;
    if (current?.serverVersion === incoming.serverVersion
      && ((current.lastOperationId && incoming.lastOperationId && current.lastOperationId !== incoming.lastOperationId)
        || current.deleted !== incoming.deleted)) return;
    this.observed.set(key, incoming);
  }
  operation({ entityType, entityId, action, entity, projectionLocalId = "" }) {
    this.operationCounter += 1;
    const operationId = `${this.name}-operation-${this.operationCounter}`;
    return { operationId, idempotencyKey: `${this.workshopId}:${operationId}`, workshopId: this.workshopId,
      entityType, entityId, action, baseVersion: this.base(entityType, entityId),
      payload: action === "delete" ? (projectionLocalId ? { projectionLocalId } : {}) : { entity: clone(entity) },
      clientTimestamp: this.clockMs, createdAt: this.nowIso(), updatedAt: this.nowIso(), syncStatus: "pending", retryCount: 0, lastError: "" };
  }
  enqueue(candidate) {
    const existing = this.outbox.find((op) => op.syncStatus === "pending" && op.entityType === candidate.entityType && op.entityId === candidate.entityId);
    if (existing && ["case", "booking", "workshop_settings"].includes(candidate.entityType)) {
      existing.payload = clone(candidate.payload); existing.action = candidate.action; existing.updatedAt = candidate.updatedAt;
      this.persist(); return clone(existing);
    }
    this.outbox.push(clone(candidate)); this.persist(); return clone(candidate);
  }
  editCase(id, patch = {}) { const current = this.state.cases.get(id) || makeHarnessCase({ id }); const next = { ...clone(current), ...clone(patch), id, localRevision: Number(current.localRevision || 0) + 1, updatedAt: this.nowIso() }; this.state.cases.set(id, next); return this.enqueue(this.operation({ entityType: "case", entityId: id, action: "upsert", entity: next })); }
  recreateCase(id, payload = {}) { const next = makeHarnessCase({ ...clone(payload), id, localRevision: Number(payload.localRevision || 0) + 1, updatedAt: this.nowIso() }); this.state.cases.set(id, next); return this.enqueue(this.operation({ entityType: "case", entityId: id, action: "upsert", entity: next })); }
  deleteCase(id) { const current = this.state.cases.get(id) || makeHarnessCase({ id }); this.state.cases.delete(id); return this.enqueue(this.operation({ entityType: "case", entityId: id, action: "delete", projectionLocalId: caseSyncLocalIdForHarness(current) })); }
  editBooking(id, patch = {}) { const current = this.state.bookings.get(id) || makeHarnessBooking({ id }); const next = { ...clone(current), ...clone(patch), id, localRevision: Number(current.localRevision || 0) + 1, updatedAt: this.nowIso() }; this.state.bookings.set(id, next); return this.enqueue(this.operation({ entityType: "booking", entityId: id, action: "upsert", entity: next })); }
  deleteBooking(id) { this.state.bookings.delete(id); return this.enqueue(this.operation({ entityType: "booking", entityId: id, action: "delete" })); }
  editSettings(patch) { this.state.settings = { ...clone(this.state.settings), ...clone(patch) }; return this.enqueue(this.operation({ entityType: "workshop_settings", entityId: "workshop_settings", action: "upsert", entity: this.state.settings })); }
  appendAudit(entry) { this.state.auditLog.set(entry.id, clone(entry)); return this.enqueue(this.operation({ entityType: "audit", entityId: entry.id, action: "append", entity: entry })); }
  bootstrap() { for (const type of ["case", "booking"]) { const rows = this.server.pollRows(this.workshopId, type); rows.forEach((row) => this.applyRemoteEntityRow(row)); const last = rows.at(-1); this.syncMetadata[type] = last ? { updatedAt: last.updated_at, entityId: last.entity_id } : null; } const settings = this.server.settings.get(this.workshopId); if (settings) { this.state.settings = clone(settings.value); this.remember({ entity_version: settings.entity_version, last_operation_id: settings.last_operation_id, updated_at: settings.updated_at }, "workshop_settings", "workshop_settings"); } this.persist(); return this; }
  poll() { for (const type of ["case", "booking"]) { const rows = this.server.pollRows(this.workshopId, type, this.syncMetadata[type]); rows.forEach((row) => this.applyRemoteEntityRow(row)); const last = rows.at(-1); if (last) this.syncMetadata[type] = { updatedAt: last.updated_at, entityId: last.entity_id }; } this.persist(); return this; }
  activeOperation(type, id) { return this.outbox.find((op) => op.entityType === type && op.entityId === id && ["pending", "processing", "failed", "conflicted"].includes(op.syncStatus)); }
  applyRemoteEntityRow(row) {
    if (!row || row.workshop_id !== this.workshopId) return false;
    const prior = this.observed.get(this.observedKey(row.entity_type, row.entity_id)); const version = Number(row.entity_version);
    if (prior && prior.serverVersion > version) return false;
    if (prior && prior.serverVersion === version) { if (prior.lastOperationId === row.last_operation_id && prior.deleted === Boolean(row.deleted_at)) return false; this.suspiciousRealtime.push(clone(row)); return false; }
    const pending = this.activeOperation(row.entity_type, row.entity_id);
    this.remember(row);
    if (pending && pending.operationId !== row.last_operation_id) { this.persist(); return false; }
    const collection = row.entity_type === "case" ? this.state.cases : this.state.bookings;
    if (row.deleted_at) collection.delete(row.entity_id); else collection.set(row.entity_id, { ...clone(row.payload), id: row.entity_id });
    this.persist(); return true;
  }
  nextSendable() { return this.outbox.filter((op) => ["pending", "processing", "failed"].includes(op.syncStatus)).sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt))[0] || null; }
  sendNext({ response = "immediate" } = {}) {
    if (!this.online) return { acknowledged: false, offline: true };
    const operation = this.nextSendable(); if (!operation) return { acknowledged: true, empty: true };
    operation.syncStatus = "processing"; this.persist(); return this._send(operation, response);
  }
  _send(operation, response) {
    try {
      let outcome;
      if (["case", "booking"].includes(operation.entityType)) { outcome = this.server.applyEntity(operation); if (operation.entityType === "case" && outcome.canonical) this.server.reconcileProjection(outcome.canonical); }
      else if (operation.entityType === "workshop_settings") outcome = this.server.applySettings(operation);
      else { this.server.applyAudit(operation); outcome = { accepted: true, status: "accepted" }; }
      if (response === "drop") throw new Error("Injected lost response after canonical apply");
      if (response === "delay") { this.server.delayedResponses.set(`${this.name}\u0000${operation.operationId}`, { operation: clone(operation), outcome: clone(outcome) }); return { acknowledged: false, delayed: true, operationId: operation.operationId, ...outcome }; }
      return this._settle(operation, outcome);
    } catch (error) { const retained = this.outbox.find((op) => op.operationId === operation.operationId); if (retained) { retained.syncStatus = "failed"; retained.retryCount += 1; retained.lastError = String(error.message); } this.persist(); return { acknowledged: false, error: String(error.message), operationId: operation.operationId }; }
  }
  _settle(operation, outcome) {
    if (this.failNextAtomicSettlement) { this.failNextAtomicSettlement = false; throw new Error("Injected atomic settlement failure"); }
    if (outcome.conflict) {
      const retained = this.outbox.find((op) => op.operationId === operation.operationId);
      retained.syncStatus = "conflicted"; retained.conflictId = outcome.conflictId; retained.serverVersion = outcome.serverVersion; retained.canonical = clone(outcome.canonical);
      if (outcome.canonical) {
        if (operation.entityType === "workshop_settings") this.remember(outcome.canonical, "workshop_settings", "workshop_settings");
        else this.remember(outcome.canonical);
      }
      if (!this.syncConflicts.some((entry) => entry.operationId === operation.operationId)) this.syncConflicts.push({ id: outcome.conflictId, operationId: operation.operationId, status: "open", localPayload: clone(operation.payload), canonical: clone(outcome.canonical), serverVersion: outcome.serverVersion });
      this.persist(); return { acknowledged: false, conflicted: true, ...outcome };
    }
    if (outcome.canonical) {
      if (operation.entityType === "workshop_settings") this.remember(outcome.canonical, "workshop_settings", "workshop_settings");
      else this.remember(outcome.canonical);
    }
    this.outbox = this.outbox.filter((op) => op.operationId !== operation.operationId); this.persist();
    return { acknowledged: true, ...outcome };
  }
  flushAll() { const results = []; while (this.nextSendable()) results.push(this.sendNext()); return results; }
  resolveConflict(conflictId, action) {
    const conflict = this.syncConflicts.find((entry) => entry.id === conflictId); const old = this.outbox.find((op) => op.operationId === conflict?.operationId);
    if (!conflict || !old) throw new Error("Conflict not found");
    if (action === "keep_local") { const replacement = this.operation({ entityType: old.entityType, entityId: old.entityId, action: old.action, entity: old.payload?.entity, projectionLocalId: old.payload?.projectionLocalId }); replacement.baseVersion = conflict.serverVersion; this.outbox.push(replacement); conflict.replacementOperationId = replacement.operationId; }
    else if (action === "accept_server" && conflict.canonical) { const row = conflict.canonical; const collection = row.entity_type === "case" ? this.state.cases : this.state.bookings; if (row.deleted_at) collection.delete(row.entity_id); else collection.set(row.entity_id, { ...clone(row.payload), id: row.entity_id }); }
    this.outbox = this.outbox.filter((op) => op.operationId !== old.operationId); conflict.status = "resolved"; this.persist(); return clone(conflict);
  }
  case(id) { return clone(this.state.cases.get(id) || null); }
  booking(id) { return clone(this.state.bookings.get(id) || null); }
  outboxSummary() { return this.outbox.map((op) => ({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, action: op.action, baseVersion: op.baseVersion, syncStatus: op.syncStatus, conflictId: op.conflictId || "", retryCount: op.retryCount })); }
}

export function createMultiClientSyncHarness({ baseTimeMs = 1_700_000_000_000 } = {}) {
  const harness = { baseTimeMs, clients: new Map(), server: null,
    addClient(name, options = {}) { const client = new ModelDClient(harness, name, { clockMs: baseTimeMs, ...options }); harness.clients.set(name, client); harness.server.registerClient(client); return client; },
    restartClient(name) { const prior = harness.clients.get(name); const next = new ModelDClient(harness, name, { workshopId: prior.workshopId, clockMs: prior.clockMs, persisted: prior.persistedSnapshot() }); next.online = prior.online; harness.clients.set(name, next); harness.server.registerClient(next); return next; },
  };
  harness.server = new ModelDServer(harness, baseTimeMs);
  return harness;
}
