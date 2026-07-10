const PLAIN_JSON_EXPORT_CONFIRMATION = "EXPORT NON CHIFFRE";
const RESTORE_BACKUP_CONFIRMATION = "RESTAURER";

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

function getAutosaveHealth() {
  const result = { principal: false, mirror: false, snapshots: 0, lastSavedAt: "", appVersion: APP_VERSION, casesCount: state.cases.length, errors: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    result.principal = !!(parsed && Array.isArray(parsed.cases));
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
  const ok = health.principal && health.mirror && health.snapshots > 0 && !health.errors.length;
  target.dataset.state = ok ? "ok" : "error";
  target.innerHTML = `
    <strong>${ok ? "Sauvegarde automatique OK" : "Contrôle sauvegarde à vérifier"}</strong><br />
    Dernière sauvegarde locale : ${formatBackupDate(health.lastSavedAt)} · Version : ${health.appVersion} · Dossiers : ${health.casesCount}<br />
    Principal : ${health.principal ? "OK" : "manquant"} · Miroir : ${health.mirror ? "OK" : "manquant"} · Points de restauration : ${health.snapshots}<br />
    Cloud auto : ${health.cloud ? formatBackupDate(health.cloud) : "non configuré"}${health.cloudError ? ` · Dernière erreur cloud : ${health.cloudError}` : ""}
    ${health.errors.length ? `<br />Erreurs : ${health.errors.join(", ")}` : ""}
  `;
}

function controlAutosaveHealth() {
  saveState({ skipCloud: true });
  renderAutosaveHealthStatus();
  const health = getAutosaveHealth();
  if (health.principal && health.mirror) {
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
    state = normalizeState(chosen.state);
    if (typeof initializeLastKnownCasesComparable === "function") {
      initializeLastKnownCasesComparable();
    }
    activeCaseId = state.cases[0]?.id ?? null;
    generatedProposals = {};
    addAuditLog("backup.snapshot.restored", "Point de restauration automatique restauré", formatSensitiveActionAuditDetails("restore-automatic-snapshot", {
      snapshotAt: chosen.savedAt || "inconnu",
      cases: state.cases.length,
    }, restoreActor), { actor: restoreActor });
    saveState({ skipCloud: true });
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
      clearJson: true,
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
      clearJson: false,
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
  const recoveryImport = typeof canUseFirstAccessRecovery === "function" && canUseFirstAccessRecovery();
  const permissionGuard = recoveryImport ? { ok: true } : guardSensitiveAction("import.backup");
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
    state = normalizeState(importedState);
    if (typeof initializeLastKnownCasesComparable === "function") {
      initializeLastKnownCasesComparable();
    }
    activeCaseId = state.cases[0]?.id ?? null;
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
    saveState();
    render();
    if (typeof checkUserSessionStartup === "function") checkUserSessionStartup();
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
  saveState();
  renderCaseDetail();
}

function autoFillVehicleFromCurrentFields(item, root) {
  if (!vehicleRecords.length) return;
  const record = findVehicleRecord(item.plate) || findVehicleRecord(item.vin);
  if (!record) return;
  applyVehicleRecord(item, record);
  saveState();
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

function canExportClearJson(role) {
  return role === "admin_technique" || role === "admin";
}

function assertCanExportClearJson(role) {
  if (!canExportClearJson(role)) {
    throw new Error("Action réservée à l'admin technique.");
  }
}

window.canExportClearJson = canExportClearJson;
window.assertCanExportClearJson = assertCanExportClearJson;
