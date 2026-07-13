(function exposeWorkHoursSync(root) {
  "use strict";

  const WORK_HOURS_SYNC_STORAGE_KEY =
    "nimr-carrosserie-v1:work-hours-sync:v1";
  const WORK_HOURS_SYNC_VERSION = 1;
  let memoryMeta = null;

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonicalizeWorkHours(workHours = {}) {
    const canonical = {};
    for (let day = 0; day <= 6; day += 1) {
      const intervals = Array.isArray(workHours?.[day])
        ? workHours[day]
        : Array.isArray(workHours?.[String(day)])
          ? workHours[String(day)]
          : [];
      canonical[day] = intervals
        .filter(
          (interval) =>
            Array.isArray(interval)
            && interval.length === 2,
        )
        .map(([start, end]) => [
          String(start ?? "").trim(),
          String(end ?? "").trim(),
        ])
        .filter(([start, end]) => start && end);
    }
    return canonical;
  }

  function hashWorkHoursString(input = "") {
    const value = String(input || "");
    let hashA = 2166136261;
    let hashB = 2654435769;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      hashA ^= code;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= code + index;
      hashB = Math.imul(hashB, 2246822519);
    }
    return [
      "work-hours-v1",
      value.length,
      (hashA >>> 0).toString(16).padStart(8, "0"),
      (hashB >>> 0).toString(16).padStart(8, "0"),
    ].join(":");
  }

  function getWorkHoursFingerprint(workHours = {}) {
    return hashWorkHoursString(
      JSON.stringify(canonicalizeWorkHours(workHours)),
    );
  }

  function normalizeIso(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toISOString();
  }

  function readWorkHoursSyncMeta() {
    try {
      const raw = root.localStorage?.getItem(
        WORK_HOURS_SYNC_STORAGE_KEY,
      );
      if (!raw) return memoryMeta ? cloneJson(memoryMeta) : {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? parsed
        : {};
    } catch {
      return memoryMeta ? cloneJson(memoryMeta) : {};
    }
  }

  function publishWorkHoursSyncStatus(meta) {
    const snapshot = cloneJson(meta || {});
    root.NIMR_WORK_HOURS_SYNC_STATUS = snapshot;
    return snapshot;
  }

  function writeWorkHoursSyncMeta(meta = {}) {
    const normalized = {
      version: WORK_HOURS_SYNC_VERSION,
      pending: Boolean(meta.pending),
      status: String(meta.status || ""),
      localFingerprint: String(meta.localFingerprint || ""),
      baseFingerprint: String(meta.baseFingerprint || ""),
      acknowledgedFingerprint: String(
        meta.acknowledgedFingerprint || "",
      ),
      localChangedAt: normalizeIso(meta.localChangedAt),
      acknowledgedAt: normalizeIso(meta.acknowledgedAt),
      lastRemoteFingerprint: String(
        meta.lastRemoteFingerprint || "",
      ),
      lastRemoteUpdatedAt: normalizeIso(
        meta.lastRemoteUpdatedAt,
      ),
      lastDecision: String(meta.lastDecision || ""),
      conflictKey: String(meta.conflictKey || ""),
      updatedAt: new Date().toISOString(),
    };
    memoryMeta = normalized;
    try {
      root.localStorage?.setItem(
        WORK_HOURS_SYNC_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // Le repli mémoire conserve la protection pendant la session.
    }
    return publishWorkHoursSyncStatus(normalized);
  }

  function getWorkHoursSyncMeta() {
    const meta = readWorkHoursSyncMeta();
    const hasStaleConflictKey = Boolean(
      meta.conflictKey
      && (
        meta.status !== "conflict"
        || meta.lastDecision !== "preserve_local_conflict"
      ),
    );
    if (hasStaleConflictKey) {
      return writeWorkHoursSyncMeta({
        ...meta,
        conflictKey: "",
      });
    }
    return publishWorkHoursSyncStatus(meta);
  }

  function markWorkHoursLocallyModified(
    workHours,
    options = {},
  ) {
    const previous = readWorkHoursSyncMeta();
    const currentFingerprint =
      getWorkHoursFingerprint(workHours);
    const previousFingerprint =
      getWorkHoursFingerprint(
        options.previousWorkHours || workHours,
      );
    const acknowledgedFingerprint =
      previous.acknowledgedFingerprint
      || previousFingerprint;
    const baseFingerprint = previous.pending
      ? (
        previous.baseFingerprint
        || acknowledgedFingerprint
        || previousFingerprint
      )
      : (
        acknowledgedFingerprint
        || previousFingerprint
      );
    const pending =
      currentFingerprint !== acknowledgedFingerprint;
    return writeWorkHoursSyncMeta({
      ...previous,
      pending,
      status: pending ? "pending_local" : "acknowledged",
      localFingerprint: currentFingerprint,
      baseFingerprint,
      acknowledgedFingerprint,
      localChangedAt: options.changedAt || new Date(),
      lastDecision: "local_edit",
      // Toute nouvelle édition locale invalide le conflit précédent :
      // ses empreintes ne décrivent plus la valeur locale courante.
      conflictKey: "",
    });
  }

  function hasPendingWorkHoursChange(workHours) {
    const meta = readWorkHoursSyncMeta();
    const currentFingerprint =
      getWorkHoursFingerprint(workHours);
    return Boolean(
      meta.pending
      && meta.localFingerprint
      && meta.localFingerprint === currentFingerprint,
    );
  }

  function hasBlockingWorkHoursConflict(workHours) {
    const meta = readWorkHoursSyncMeta();
    const currentFingerprint =
      getWorkHoursFingerprint(workHours);
    return Boolean(
      meta.pending
      && meta.status === "conflict"
      && meta.lastDecision === "preserve_local_conflict"
      && meta.conflictKey
      && meta.localFingerprint
      && meta.localFingerprint === currentFingerprint,
    );
  }

  function acceptRemoteWorkHoursSync(
    remoteWorkHours,
    options = {},
  ) {
    const remoteFingerprint =
      getWorkHoursFingerprint(remoteWorkHours);
    return writeWorkHoursSyncMeta({
      pending: false,
      status: "remote_accepted",
      localFingerprint: remoteFingerprint,
      baseFingerprint: remoteFingerprint,
      acknowledgedFingerprint: remoteFingerprint,
      localChangedAt: "",
      acknowledgedAt:
        options.updatedAt || new Date(),
      lastRemoteFingerprint: remoteFingerprint,
      lastRemoteUpdatedAt:
        options.updatedAt || new Date(),
      lastDecision: options.decision || "accept_remote",
      conflictKey: "",
    });
  }

  function acknowledgeWorkHoursSync(
    currentWorkHours,
    evidence = {},
  ) {
    const currentFingerprint =
      getWorkHoursFingerprint(currentWorkHours);
    const cloudBackupFingerprint = String(
      evidence.cloudBackupFingerprint || "",
    );
    const appSettingsFingerprint = String(
      evidence.appSettingsFingerprint || "",
    );
    const previous = readWorkHoursSyncMeta();
    const sameEvidence = Boolean(
      cloudBackupFingerprint
      && appSettingsFingerprint
      && cloudBackupFingerprint === currentFingerprint
      && appSettingsFingerprint === currentFingerprint,
    );
    const stillCurrent = Boolean(
      !previous.localFingerprint
      || previous.localFingerprint === currentFingerprint,
    );

    if (!sameEvidence || !stillCurrent) {
      return {
        acknowledged: false,
        currentFingerprint,
        cloudBackupFingerprint,
        appSettingsFingerprint,
        meta: publishWorkHoursSyncStatus(previous),
      };
    }

    const meta = writeWorkHoursSyncMeta({
      ...previous,
      pending: false,
      status: "acknowledged",
      localFingerprint: currentFingerprint,
      baseFingerprint: currentFingerprint,
      acknowledgedFingerprint: currentFingerprint,
      localChangedAt: "",
      acknowledgedAt:
        evidence.updatedAt || new Date(),
      lastRemoteFingerprint: currentFingerprint,
      lastRemoteUpdatedAt:
        evidence.updatedAt || new Date(),
      lastDecision: "dual_store_acknowledged",
      conflictKey: "",
    });

    return {
      acknowledged: true,
      currentFingerprint,
      cloudBackupFingerprint,
      appSettingsFingerprint,
      meta,
    };
  }

  function makeConflictId() {
    if (
      root.crypto
      && typeof root.crypto.randomUUID === "function"
    ) {
      return `sync-conflict-${root.crypto.randomUUID()}`;
    }
    return [
      "sync-conflict-work-hours",
      Date.now(),
      Math.random().toString(36).slice(2, 10),
    ].join("-");
  }

  function buildWorkHoursConflict({
    localWorkHours,
    remoteWorkHours,
    localFingerprint,
    remoteFingerprint,
    remoteUpdatedAt,
  }) {
    const hashes = [
      localFingerprint,
      remoteFingerprint,
    ].sort();
    const conflictKey =
      `work-hours:${hashes[0]}:${hashes[1]}`;
    const now = new Date().toISOString();
    return {
      id: makeConflictId(),
      at: now,
      createdAt: now,
      type: "work_hours_conflict",
      entityType: "workshop_settings",
      entity: "workshop_settings",
      entityId: "workshop_settings",
      field: "workHours",
      localValue: cloneJson(localWorkHours),
      remoteValue: cloneJson(remoteWorkHours),
      status: "open",
      decision: "needs_review",
      resolution: "kept_local",
      reason:
        "Le calendrier local non synchronisé diffère d'une version cloud plus récente.",
      label: "Conflit horaires atelier",
      details:
        "Les horaires locaux ont été conservés. Une comparaison manuelle est requise avant remplacement.",
      conflictKey,
      remoteUpdatedAt: normalizeIso(remoteUpdatedAt),
    };
  }

  function resolveWorkHoursRemoteMerge(
    localWorkHours,
    remoteWorkHours,
    options = {},
  ) {
    const localCanonical =
      canonicalizeWorkHours(localWorkHours);
    const remoteCanonical =
      canonicalizeWorkHours(remoteWorkHours);
    const localFingerprint =
      getWorkHoursFingerprint(localCanonical);
    const remoteFingerprint =
      getWorkHoursFingerprint(remoteCanonical);
    const previous = readWorkHoursSyncMeta();
    const remoteUpdatedAt =
      normalizeIso(options.remoteUpdatedAt);
    const pending = Boolean(
      previous.pending
      && previous.localFingerprint === localFingerprint,
    );

    if (localFingerprint === remoteFingerprint) {
      writeWorkHoursSyncMeta({
        ...previous,
        pending,
        status: pending
          ? "pending_remote_matches"
          : "in_sync",
        localFingerprint,
        lastRemoteFingerprint: remoteFingerprint,
        lastRemoteUpdatedAt: remoteUpdatedAt,
        lastDecision: "values_match",
        conflictKey: "",
      });
      return {
        workHours: localCanonical,
        decision: "values_match",
        conflict: null,
        localFingerprint,
        remoteFingerprint,
      };
    }

    if (!pending) {
      acceptRemoteWorkHoursSync(remoteCanonical, {
        updatedAt: remoteUpdatedAt || new Date(),
        decision: "accept_remote_clean_local",
      });
      return {
        workHours: remoteCanonical,
        decision: "accept_remote_clean_local",
        conflict: null,
        localFingerprint,
        remoteFingerprint,
      };
    }

    const remoteTime = remoteUpdatedAt
      ? new Date(remoteUpdatedAt).getTime()
      : 0;
    const localTime = previous.localChangedAt
      ? new Date(previous.localChangedAt).getTime()
      : 0;
    const remoteMatchesBase = Boolean(
      previous.baseFingerprint
      && remoteFingerprint === previous.baseFingerprint,
    );
    const remoteNotNewer = Boolean(
      remoteTime
      && localTime
      && remoteTime <= localTime,
    );

    if (remoteMatchesBase || remoteNotNewer) {
      writeWorkHoursSyncMeta({
        ...previous,
        pending: true,
        status: "pending_local_preserved",
        localFingerprint,
        lastRemoteFingerprint: remoteFingerprint,
        lastRemoteUpdatedAt: remoteUpdatedAt,
        lastDecision: remoteMatchesBase
          ? "preserve_local_remote_is_base"
          : "preserve_local_remote_older",
        conflictKey: "",
      });
      return {
        workHours: localCanonical,
        decision: remoteMatchesBase
          ? "preserve_local_remote_is_base"
          : "preserve_local_remote_older",
        conflict: null,
        localFingerprint,
        remoteFingerprint,
      };
    }

    const conflict = buildWorkHoursConflict({
      localWorkHours: localCanonical,
      remoteWorkHours: remoteCanonical,
      localFingerprint,
      remoteFingerprint,
      remoteUpdatedAt,
    });
    writeWorkHoursSyncMeta({
      ...previous,
      pending: true,
      status: "conflict",
      localFingerprint,
      lastRemoteFingerprint: remoteFingerprint,
      lastRemoteUpdatedAt: remoteUpdatedAt,
      lastDecision: "preserve_local_conflict",
      conflictKey: conflict.conflictKey,
    });
    return {
      workHours: localCanonical,
      decision: "preserve_local_conflict",
      conflict,
      localFingerprint,
      remoteFingerprint,
    };
  }

  const api = Object.freeze({
    WORK_HOURS_SYNC_STORAGE_KEY,
    canonicalizeWorkHours,
    getWorkHoursFingerprint,
    getWorkHoursSyncMeta,
    markWorkHoursLocallyModified,
    hasPendingWorkHoursChange,
    hasBlockingWorkHoursConflict,
    acceptRemoteWorkHoursSync,
    acknowledgeWorkHoursSync,
    resolveWorkHoursRemoteMerge,
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
