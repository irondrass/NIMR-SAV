let nimrSupabaseClient = null;

function getSupabaseConfig() {
  return window.NIMR_SUPABASE_CONFIG || {};
}

function getSupabaseWorkshopId() {
  const config = getSupabaseConfig();
  return String(config.workshopId || window.NIMR_DEFAULT_WORKSHOP_ID || "00000000-0000-0000-0000-000000000001").trim();
}

function decodeSupabaseJwtPayload(key = "") {
  const part = String(key || "").split(".")[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch (error) {
    return null;
  }
}

function looksLikeSupabaseServiceRoleKey(key = "") {
  const payload = decodeSupabaseJwtPayload(key);
  return String(payload?.role || "").toLowerCase() === "service_role";
}

function resetSupabaseClient() {
  nimrSupabaseClient = null;
}

function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.enabled && config.url && config.anonKey);
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!window.supabase?.createClient) return null;
  if (!nimrSupabaseClient) {
    const config = getSupabaseConfig();
    nimrSupabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return nimrSupabaseClient;
}

function setSupabaseStatus(message, stateName = "") {
  const target = $("#supabase-status");
  if (!target) return;
  target.textContent = message;
  target.dataset.state = stateName;
}

function setSupabaseDetails(message = "") {
  const target = $("#supabase-details");
  if (!target) return;
  target.textContent = message;
}

async function getSupabaseUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data?.user || null;
}

async function refreshSupabasePanel() {
  const safetyContainer = $("#supabase-safety-download-container");
  if (safetyContainer) {
    const hasSnapshot = localStorage.getItem("nimr-sav-restore-safety-snapshot:last");
    safetyContainer.style.display = hasSnapshot ? "block" : "none";
  }

  const client = getSupabaseClient();
  hydrateSupabaseConfigForm();
  if (!isSupabaseConfigured()) {
    setSupabaseStatus("Supabase non configuré : synchronisation cloud inactive.", "error");
    setSupabaseDetails("Renseignez l'URL projet, la publishable key / clé publique Supabase et l'ID atelier. N'utilisez jamais service_role côté navigateur ; vérifiez l'authentification et RLS avant usage réel.");
    return;
  }
  if (!client) {
    setSupabaseStatus("Librairie Supabase non chargée : synchronisation indisponible.", "error");
    setSupabaseDetails("Vérifiez la connexion internet du poste ou le chargement du script CDN Supabase dans index.html.");
    return;
  }
  const user = await getSupabaseUser();
  if (user) {
    if (typeof syncCurrentUserWithSupabaseAuth === "function" && syncCurrentUserWithSupabaseAuth(user)) {
      saveState({ skipCloud: true });
    }
    setSupabaseStatus(`Connecté : ${user.email || user.id}`, "ok");
    setSupabaseDetails("Synchronisation multi-PC active : les modifications sont sauvegardées et reçues depuis Supabase selon l'authentification et les règles RLS de l'atelier.");
  } else {
    setSupabaseStatus("Supabase configuré, utilisateur non connecté.", "warn");
    setSupabaseDetails("Connectez-vous avec un compte Supabase autorisé. Les sauvegardes cloud restent bloquées tant que la session n'est pas active.");
  }
}

function hydrateSupabaseConfigForm() {
  const form = $("#supabase-config-form");
  if (!form) return;
  const config = getSupabaseConfig();
  if (document.activeElement && form.contains(document.activeElement)) return;
  form.elements.url.value = config.url || "";
  form.elements.anonKey.value = config.anonKey || "";
  form.elements.workshopId.value = getSupabaseWorkshopId();
  form.elements.backupKey.value = config.backupKey || "nimr-sav-main";
}

function saveSupabaseRuntimeConfigFromForm(event) {
  event.preventDefault();
  const permissionGuard = guardSensitiveAction("supabase.configure");
  if (!permissionGuard.ok) return;
  const form = event.currentTarget;
  const publicKey = form.elements.anonKey.value.trim();
  if (looksLikeSupabaseServiceRoleKey(publicKey)) {
    addAuditLog("supabase.config.rejected", "Clé Supabase refusée", "Une clé service_role ne doit jamais être utilisée côté navigateur.");
    saveState({ skipCloud: true, skipSnapshot: true });
    notifyUser("Clé Supabase refusée : utilisez la publishable key / clé publique Supabase, jamais service_role côté navigateur.", "error");
    return;
  }
  const nextConfig = {
    enabled: Boolean(form.elements.url.value.trim() && publicKey),
    url: form.elements.url.value.trim(),
    anonKey: publicKey,
    workshopId: form.elements.workshopId.value.trim() || window.NIMR_DEFAULT_WORKSHOP_ID,
    backupKey: form.elements.backupKey.value.trim() || "nimr-sav-main",
    backupTable: "cloud_backups",
    allowRuntimeConfig: true,
  };
  try {
    localStorage.setItem(window.NIMR_SUPABASE_RUNTIME_CONFIG_KEY, JSON.stringify(nextConfig));
    window.NIMR_SUPABASE_CONFIG = { ...getSupabaseConfig(), ...nextConfig };
    resetSupabaseClient();
    addAuditLog("supabase.config.updated", "Configuration Supabase modifiée", nextConfig.enabled ? "Synchronisation cloud configurée avec une publishable key / clé publique Supabase. RLS doit être activé avant usage réel." : "Configuration cloud désactivée.");
    saveState({ skipCloud: true, skipSnapshot: true });
    notifyUser("Configuration Supabase enregistrée sur ce poste.", "success");
    refreshSupabasePanel();
  } catch (error) {
    console.error("Enregistrement config Supabase impossible", error);
    notifyUser("Impossible d'enregistrer la configuration Supabase locale. Vérifiez le stockage du navigateur et les droits de l'utilisateur.", "error");
  }
}

function clearSupabaseRuntimeConfig() {
  const permissionGuard = guardSensitiveAction("supabase.configure");
  if (!permissionGuard.ok) return;
  localStorage.removeItem(window.NIMR_SUPABASE_RUNTIME_CONFIG_KEY);
  window.NIMR_SUPABASE_CONFIG = {
    enabled: false,
    url: "",
    anonKey: "",
    workshopId: window.NIMR_DEFAULT_WORKSHOP_ID,
    backupKey: "nimr-sav-main",
    backupTable: "cloud_backups",
    allowRuntimeConfig: true,
  };
  resetSupabaseClient();
  if (typeof stopSupabaseLiveSync === "function") stopSupabaseLiveSync();
  addAuditLog("supabase.config.cleared", "Configuration Supabase retirée", "Configuration cloud locale retirée de ce navigateur.");
  saveState({ skipCloud: true, skipSnapshot: true });
  notifyUser("Configuration Supabase retirée de ce navigateur.", "success");
  refreshSupabasePanel();
}

function bindSupabaseConfigForm() {
  const form = $("#supabase-config-form");
  form?.addEventListener("submit", saveSupabaseRuntimeConfigFromForm);
  $("#supabase-config-clear")?.addEventListener("click", clearSupabaseRuntimeConfig);
  hydrateSupabaseConfigForm();
  const permissionGuard = guardSensitiveAction("supabase.configure", {}, { notify: false });
  if (form) {
    $$("input, button", form).forEach((control) => {
      control.disabled = !permissionGuard.ok;
      control.title = permissionGuard.message;
    });
  }
  const clearButton = $("#supabase-config-clear");
  if (clearButton) {
    clearButton.disabled = !permissionGuard.ok;
    clearButton.title = permissionGuard.message;
  }
}
