let nimrSupabaseClient = null;

function getSupabaseConfig() {
  return window.NIMR_SUPABASE_CONFIG || {};
}

function getSupabaseWorkshopId() {
  const config = getSupabaseConfig();
  return String(config.workshopId || window.NIMR_DEFAULT_WORKSHOP_ID || "00000000-0000-0000-0000-000000000001").trim();
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
  const client = getSupabaseClient();
  hydrateSupabaseConfigForm();
  if (!isSupabaseConfigured()) {
    setSupabaseStatus("Supabase non configuré.", "error");
    setSupabaseDetails("Renseignez l'URL projet, la clé anon publique et l'ID atelier dans Paramètres > Cloud Supabase. Ces valeurs restent dans ce navigateur.");
    return;
  }
  if (!client) {
    setSupabaseStatus("Librairie Supabase non chargée.", "error");
    setSupabaseDetails("Vérifiez votre connexion internet ou le script CDN Supabase dans index.html.");
    return;
  }
  const user = await getSupabaseUser();
  if (user) {
    if (typeof syncCurrentUserWithSupabaseAuth === "function" && syncCurrentUserWithSupabaseAuth(user)) {
      saveState({ skipCloud: true });
    }
    setSupabaseStatus(`Connecté : ${user.email || user.id}`, "ok");
    setSupabaseDetails("Synchronisation multi-PC active : les modifications sont sauvegardées et reçues depuis Supabase.");
  } else {
    setSupabaseStatus("Supabase configuré, utilisateur non connecté.", "warn");
    setSupabaseDetails("Connectez-vous avec l'utilisateur créé dans Authentication > Users.");
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
  const nextConfig = {
    enabled: Boolean(form.elements.url.value.trim() && form.elements.anonKey.value.trim()),
    url: form.elements.url.value.trim(),
    anonKey: form.elements.anonKey.value.trim(),
    workshopId: form.elements.workshopId.value.trim() || window.NIMR_DEFAULT_WORKSHOP_ID,
    backupKey: form.elements.backupKey.value.trim() || "nimr-sav-main",
    backupTable: "cloud_backups",
    allowRuntimeConfig: true,
  };
  try {
    localStorage.setItem(window.NIMR_SUPABASE_RUNTIME_CONFIG_KEY, JSON.stringify(nextConfig));
    window.NIMR_SUPABASE_CONFIG = { ...getSupabaseConfig(), ...nextConfig };
    resetSupabaseClient();
    addAuditLog("supabase.config.updated", "Configuration Supabase modifiée", nextConfig.enabled ? "Synchronisation cloud configurée sur ce poste." : "Configuration cloud désactivée.");
    saveState({ skipCloud: true, skipSnapshot: true });
    notifyUser("Configuration Supabase enregistrée sur ce poste.", "success");
    refreshSupabasePanel();
  } catch (error) {
    console.error("Enregistrement config Supabase impossible", error);
    notifyUser("Impossible d'enregistrer la configuration Supabase locale.", "error");
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
