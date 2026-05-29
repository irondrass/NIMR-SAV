/* NIMR SAV - Correctif multi-PC v22.24
   Objectif : empêcher qu'une sauvegarde cloud complète d'un poste écrase
   les dossiers/plannings plus récents d'un autre poste.
   A charger après js/supabase-sync.js et avant app.js. */
(function installNimrSyncConflictGuard() {
  "use strict";

  const DEVICE_ID_KEY = `${STORAGE_KEY}:device-id`;
  const SYNC_FIX_VERSION = "v22.24-sync-merge";

  function getNimrDeviceId() {
    let value = "";
    try { value = localStorage.getItem(DEVICE_ID_KEY) || ""; } catch (error) { value = ""; }
    if (!value) {
      value = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try { localStorage.setItem(DEVICE_ID_KEY, value); } catch (error) { /* non critique */ }
    }
    return value;
  }

  function asTime(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function latestHistoryTime(item) {
    return Math.max(
      0,
      ...(Array.isArray(item?.history) ? item.history.map((entry) => asTime(entry?.at)) : []),
      asTime(item?.updatedAt),
      asTime(item?.modifiedAt),
      asTime(item?.createdAt),
      asTime(item?.appointment?.start || item?.appointment?.date || item?.appointment),
    );
  }

  function normalToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function caseBusinessKey(item) {
    if (!item) return "";
    const order = normalToken(item.orNavNumber);
    if (order) return `or:${order}`;
    const vin = normalToken(item.vin);
    if (vin) return `vin:${vin}`;
    const plate = normalToken(item.plate);
    const client = normalToken(item.clientName);
    if (plate || client) return `case:${plate || "no-plate"}:${client || "no-client"}`;
    return String(item.id || "");
  }

  function bookingStableKey(booking, caseKeyById) {
    if (!booking) return "";
    const caseKey = caseKeyById.get(booking.caseId) || String(booking.caseId || "no-case");
    const resourceKey = Array.isArray(booking.resourceIds) ? booking.resourceIds.join("+") : "";
    return [caseKey, booking.key || "step", booking.title || "", resourceKey].join("|");
  }

  function bookingStartTime(booking) {
    const segmentStart = Array.isArray(booking?.segments) ? booking.segments.map((segment) => asTime(segment?.start)) : [];
    return Math.max(0, asTime(booking?.start), ...segmentStart);
  }

  function copyArray(value) {
    return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
  }

  function chooseCase(localItem, remoteItem) {
    if (!localItem) return { ...remoteItem };
    if (!remoteItem) return { ...localItem };

    const localTime = latestHistoryTime(localItem);
    const remoteTime = latestHistoryTime(remoteItem);
    const localHistoryCount = Array.isArray(localItem.history) ? localItem.history.length : 0;
    const remoteHistoryCount = Array.isArray(remoteItem.history) ? remoteItem.history.length : 0;

    if (remoteTime > localTime) return { ...localItem, ...remoteItem };
    if (localTime > remoteTime) return { ...remoteItem, ...localItem };
    if (remoteHistoryCount > localHistoryCount) return { ...localItem, ...remoteItem };
    return { ...remoteItem, ...localItem };
  }

  function mergeCases(localCases, remoteCases) {
    const merged = new Map();
    copyArray(localCases).forEach((item) => {
      const key = caseBusinessKey(item) || String(item.id || "");
      if (key) merged.set(key, item);
    });
    copyArray(remoteCases).forEach((remoteItem) => {
      const key = caseBusinessKey(remoteItem) || String(remoteItem.id || "");
      if (!key) return;
      merged.set(key, chooseCase(merged.get(key), remoteItem));
    });
    return [...merged.values()];
  }

  function buildCaseKeyById(cases) {
    const map = new Map();
    (cases || []).forEach((item) => {
      const key = caseBusinessKey(item) || String(item.id || "");
      if (item?.id && key) map.set(item.id, key);
    });
    return map;
  }

  function mergeBookings(localState, remoteState, mergedCases) {
    const localCaseKeys = buildCaseKeyById(localState.cases);
    const remoteCaseKeys = buildCaseKeyById(remoteState.cases);
    const mergedCaseKeySet = new Set(mergedCases.map((item) => caseBusinessKey(item) || String(item.id || "")));
    const result = new Map();

    (localState.bookings || []).forEach((booking) => {
      const key = bookingStableKey(booking, localCaseKeys);
      if (key && mergedCaseKeySet.has((localCaseKeys.get(booking.caseId) || String(booking.caseId || "")))) {
        result.set(key, { ...booking });
      }
    });

    (remoteState.bookings || []).forEach((remoteBooking) => {
      const key = bookingStableKey(remoteBooking, remoteCaseKeys);
      if (!key) return;
      const remoteCaseKey = remoteCaseKeys.get(remoteBooking.caseId) || String(remoteBooking.caseId || "");
      const current = result.get(key);
      if (!current) {
        result.set(key, { ...remoteBooking });
        return;
      }

      const localStart = bookingStartTime(current);
      const remoteStart = bookingStartTime(remoteBooking);
      const localCase = (localState.cases || []).find((item) => caseBusinessKey(item) === remoteCaseKey || item.id === current.caseId);
      const remoteCase = (remoteState.cases || []).find((item) => caseBusinessKey(item) === remoteCaseKey || item.id === remoteBooking.caseId);
      const localCaseTime = latestHistoryTime(localCase);
      const remoteCaseTime = latestHistoryTime(remoteCase);

      // Règle anti-décalage : si le dossier local est aussi récent ou plus récent,
      // conserver le booking local. Cela empêche le 09:00 local d'être remplacé
      // par un 10:00 venu d'un état complet obsolète/recalculé.
      if (remoteCaseTime > localCaseTime && remoteStart && remoteStart !== localStart) {
        result.set(key, { ...remoteBooking });
      }
    });

    return [...result.values()];
  }

  function mergeResources(localResources, remoteResources) {
    const result = new Map();
    copyArray(localResources).forEach((resource) => { if (resource.id) result.set(resource.id, resource); });
    copyArray(remoteResources).forEach((resource) => {
      if (!resource.id || !result.has(resource.id)) result.set(resource.id, resource);
      else result.set(resource.id, { ...resource, ...result.get(resource.id) });
    });
    return [...result.values()];
  }

  function mergeRemoteStateIntoLocal(localInput, remoteInput) {
    const localState = normalizeState(localInput || {});
    const remoteState = normalizeState(remoteInput || {});
    const cases = mergeCases(localState.cases, remoteState.cases);
    const merged = {
      ...remoteState,
      ...localState,
      settings: { ...(remoteState.settings || {}), ...(localState.settings || {}) },
      workHours: localState.workHours || remoteState.workHours,
      holidays: Array.isArray(localState.holidays) && localState.holidays.length ? localState.holidays : remoteState.holidays,
      resources: mergeResources(localState.resources, remoteState.resources),
      cases,
      bookings: mergeBookings(localState, remoteState, cases),
      planningDate: localState.planningDate || remoteState.planningDate,
      syncMeta: {
        ...(remoteState.syncMeta || {}),
        ...(localState.syncMeta || {}),
        lastMergeAt: new Date().toISOString(),
        lastMergeDeviceId: getNimrDeviceId(),
        fixVersion: SYNC_FIX_VERSION,
      },
    };
    return normalizeState(merged);
  }

  async function applyMergedRemoteSupabaseBackup(data, reason = "cloud") {
    if (!shouldApplyRemoteBackup(data)) return false;
    const canApply = await confirmRemoteBackupConflict(data, reason);
    if (!canApply) return false;
    applyingRemoteSupabaseState = true;
    try {
      const previousActiveCaseId = activeCaseId;
      const previousTab = activeCaseDetailTab;
      const previousCaseCount = state?.cases?.length || 0;
      state = mergeRemoteStateIntoLocal(state, data.state);
      if (previousActiveCaseId && state.cases.some((item) => item.id === previousActiveCaseId)) activeCaseId = previousActiveCaseId;
      else activeCaseId = state.cases[0]?.id ?? null;
      activeCaseDetailTab = previousTab || "resume";
      generatedProposals = {};
      if (Array.isArray(data.photos) && data.photos.length) {
        await restorePhotoRecords(data.photos);
      }
      lastKnownCloudUpdatedAt = getTimestampMs(data.updated_at) || Date.now();
      if (typeof rememberKnownCloudUpdatedAt === "function") rememberKnownCloudUpdatedAt(lastKnownCloudUpdatedAt);
      if (typeof clearLocalUserChangeAt === "function") clearLocalUserChangeAt();
      saveState({ skipCloud: true });
      render();
      setSupabaseStatus("Synchronisation atelier fusionnée et à jour.", "ok");
      setSupabaseDetails(
        `Mise à jour reçue (${reason}) : ${new Date(lastKnownCloudUpdatedAt).toLocaleTimeString("fr-TN", { timeZone: "Africa/Tunis" })}. ` +
        `${previousCaseCount} → ${state.cases.length} dossier(s), ${state.bookings.length} créneau(x).`,
      );
      notifyUser("Mise à jour reçue depuis un autre poste, fusionnée sans écraser le planning local.", "info");
      return true;
    } catch (error) {
      console.warn("Fusion de la sauvegarde cloud impossible", error);
      setSupabaseDetails(`Synchronisation entrante impossible : ${error.message || error}`);
      return false;
    } finally {
      applyingRemoteSupabaseState = false;
    }
  }

  const originalAutoBackupToSupabase = typeof autoBackupToSupabase === "function" ? autoBackupToSupabase : null;

  applyRemoteSupabaseBackup = applyMergedRemoteSupabaseBackup;

  autoBackupToSupabase = async function guardedAutoBackupToSupabase(reason = "autosave", options = {}) {
    try {
      const client = getSupabaseClient();
      const user = await getSupabaseUser();
      if (client && user && navigator.onLine !== false) {
        const remote = await fetchLatestCloudBackup(client);
        if (remote?.state && shouldApplyRemoteBackup(remote)) {
          await applyMergedRemoteSupabaseBackup(remote, `pré-envoi ${reason}`);
        }
      }
    } catch (error) {
      console.warn("Pré-fusion cloud ignorée avant sauvegarde", error);
    }
    if (originalAutoBackupToSupabase) return originalAutoBackupToSupabase(reason, options);
    return false;
  };

  window.NIMR_SYNC_FIX_VERSION = SYNC_FIX_VERSION;
  window.getNimrDeviceId = getNimrDeviceId;
  console.info(`NIMR SAV ${SYNC_FIX_VERSION} actif pour ${getNimrDeviceId()}`);
})();
