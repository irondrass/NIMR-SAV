let nimrSupabaseClient = null;
const SEC001_SERVER_WORKSHOP_ROLES = new Set([
  "admin_technique",
  "directeur",
  "chef_atelier",
  "reception",
  "technicien",
  "controle_qualite",
  "lecture_seule",
]);

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
  const raw = String(key || "").trim();
  if (/^sb_secret_/i.test(raw) || /service[_-]?role/i.test(raw)) return true;
  const payload = decodeSupabaseJwtPayload(raw);
  return String(payload?.role || "").toLowerCase() === "service_role";
}

function resetSupabaseClient() {
  if (typeof stopSupabaseLiveSync === "function") stopSupabaseLiveSync();
  if (typeof unbindSupabaseAuthLifecycle === "function") unbindSupabaseAuthLifecycle();
  nimrSupabaseClient = null;
}

function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.enabled && config.url && config.anonKey && !looksLikeSupabaseServiceRoleKey(config.anonKey));
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

async function resolveSupabaseWorkshopMembership(authUser) {
  if (!authUser?.id) {
    return { ok: false, message: "Utilisateur non authentifié.", code: "NO_AUTH_USER" };
  }
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: "Client Supabase non initialisé.", code: "NO_CLIENT" };
  }
  const workshopId = getSupabaseWorkshopId();
  try {
    const { data, error } = await client
      .from("workshop_members")
      .select("workshop_id, user_id, role, resource_id")
      .eq("workshop_id", workshopId)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (error) {
      console.error("Erreur résolution appartenance atelier", error);
      return { ok: false, message: error.message || "Erreur de requête d'appartenance atelier.", code: "DB_ERROR" };
    }
    if (!data) {
      return {
        ok: false,
        message: "Votre compte est authentifié mais n'est pas autorisé pour cet atelier. Contactez l'administrateur NIMR SAV.",
        code: "NOT_A_MEMBER",
      };
    }
    const rawRole = String(data.role || "").trim();
    if (!SEC001_SERVER_WORKSHOP_ROLES.has(rawRole)) {
      return { ok: false, message: "Rôle d'atelier inconnu ou non supporté.", code: "UNSUPPORTED_ROLE" };
    }
    return {
      ok: true,
      membership: {
        workshop_id: data.workshop_id,
        user_id: data.user_id,
        role: rawRole,
        resource_id: data.resource_id || null,
      },
    };
  } catch (err) {
    console.error("Exception résolution appartenance atelier", err);
    return { ok: false, message: err?.message || "Échec de connexion à la base d'appartenance.", code: "EXCEPTION" };
  }
}
window.resolveSupabaseWorkshopMembership = resolveSupabaseWorkshopMembership;

const WORKSHOP_USER_ADMIN_ACTIONS = new Set(["capabilities", "invite_member", "offboard_member"]);

async function readWorkshopUserAdminInvokeError(error) {
  const context = error?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    const response = typeof context.clone === "function" ? context.clone() : context;
    const body = await response.json();
    return body && typeof body === "object" ? body : null;
  } catch (parseError) {
    return null;
  }
}

async function invokeWorkshopUserAdmin(action, payload = {}) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!WORKSHOP_USER_ADMIN_ACTIONS.has(normalizedAction)) {
    return { ok: false, code: "INVALID_ACTION", message: "Action d’administration de compte non autorisée." };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, code: "OFFLINE_NOT_ALLOWED", message: "Connexion internet requise : cette opération de sécurité ne sera pas mise en attente." };
  }
  const client = getSupabaseClient();
  if (!client?.functions?.invoke) {
    return { ok: false, code: "NO_CLIENT", message: "Client Supabase non configuré." };
  }
  try {
    const authUser = await getSupabaseUser();
    if (!authUser?.id) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Session Supabase authentifiée requise." };
    }
    const membershipResult = await resolveSupabaseWorkshopMembership(authUser);
    if (!membershipResult?.ok || !membershipResult.membership) {
      return {
        ok: false,
        code: membershipResult?.code || "INVALID_MEMBERSHIP",
        message: membershipResult?.message || "Appartenance atelier non valide.",
      };
    }
    const workshopId = String(getSupabaseWorkshopId() || "").trim();
    const membership = membershipResult.membership;
    if (String(membership.user_id || "") !== String(authUser.id)
      || !workshopId
      || String(membership.workshop_id || "") !== workshopId) {
      return {
        ok: false,
        code: "MEMBERSHIP_IDENTITY_MISMATCH",
        message: "L’appartenance atelier ne correspond pas à l’identité Supabase active.",
      };
    }
    const { data, error } = await client.functions.invoke("workshop-user-admin", {
      body: {
        ...(payload && typeof payload === "object" ? payload : {}),
        action: normalizedAction,
        workshop_id: workshopId,
      },
    });
    if (error) {
      const serverError = await readWorkshopUserAdminInvokeError(error);
      return serverError || {
        ok: false,
        code: "WORKSHOP_USER_ADMIN_FAILED",
        message: error.message || "Le service sécurisé de gestion des comptes est indisponible.",
      };
    }
    return data && typeof data === "object"
      ? data
      : { ok: false, code: "INVALID_SERVER_RESPONSE", message: "Réponse serveur de gestion des comptes invalide." };
  } catch (error) {
    return {
      ok: false,
      code: "WORKSHOP_USER_ADMIN_EXCEPTION",
      message: error?.message || "Appel sécurisé de gestion des comptes impossible.",
    };
  }
}
window.invokeWorkshopUserAdmin = invokeWorkshopUserAdmin;

async function authenticateSupabaseUser(email, password) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: "Configuration Supabase indisponible." };
  }
  const cleanEmail = String(email || "").trim();
  const cleanPass = String(password || "");
  if (!cleanEmail || !cleanPass) {
    return { ok: false, message: "Email et mot de passe requis." };
  }
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPass,
    });
    if (error || !data?.user) {
      return { ok: false, message: error?.message || "Identifiants invalides." };
    }
    const membershipRes = await resolveSupabaseWorkshopMembership(data.user);
    if (!membershipRes.ok) {
      return { ok: false, message: membershipRes.message, code: membershipRes.code, authUser: data.user };
    }
    return { ok: true, user: data.user, membership: membershipRes.membership };
  } catch (err) {
    return { ok: false, message: err?.message || "Erreur lors de l'authentification." };
  }
}
window.authenticateSupabaseUser = authenticateSupabaseUser;

async function signOutSupabaseSession() {
  const client = getSupabaseClient();
  if (!client?.auth?.signOut) {
    return { ok: false, message: "Session Supabase indisponible : déconnexion non confirmée." };
  }
  try {
    const result = await client.auth.signOut();
    if (!result || typeof result !== "object") {
      return { ok: false, message: "Réponse Supabase invalide : déconnexion non confirmée." };
    }
    if (result?.error) {
      console.warn("Erreur déconnexion session Supabase", result.error);
      return {
        ok: false,
        error: result.error,
        message: result.error.message || "Déconnexion Supabase refusée.",
      };
    }
    return { ok: true };
  } catch (error) {
    console.warn("Exception déconnexion session Supabase", error);
    return {
      ok: false,
      error,
      message: error?.message || "Déconnexion Supabase impossible.",
    };
  }
}
window.signOutSupabaseSession = signOutSupabaseSession;

async function refreshSupabasePanel() {
  if (typeof renderSupabaseSyncHealth === "function") renderSupabaseSyncHealth().catch(() => null);
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
    const membershipRes = await resolveSupabaseWorkshopMembership(user);
    if (membershipRes.ok) {
      if (typeof syncLocalUserFromSupabaseMembership === "function") {
        syncLocalUserFromSupabaseMembership(user, membershipRes.membership);
        saveState({ skipCloud: true });
      }
      setSupabaseStatus(`Connecté : ${user.email || user.id} (${membershipRes.membership.role})`, "ok");
      setSupabaseDetails("Synchronisation multi-PC active : les modifications sont sauvegardées et reçues depuis Supabase selon l'authentification et les règles RLS de l'atelier.");
    } else {
      setSupabaseStatus(`Authentifié (${user.email}) mais non autorisé pour cet atelier.`, "error");
      setSupabaseDetails(membershipRes.message || "Appartenance atelier non trouvée.");
    }
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
    notifyUser("Clé Supabase refusée : utilisez uniquement une publishable key publique ; sb_secret_ et service_role sont interdits côté navigateur.", "error");
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
    if (typeof refreshSupabasePermissionState === "function") refreshSupabasePermissionState("configuration-change");
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
  addAuditLog("supabase.config.cleared", "Configuration Supabase retirée", "Configuration cloud locale retirée de ce navigateur.");
  saveState({ skipCloud: true, skipSnapshot: true });
  notifyUser("Configuration Supabase retirée de ce navigateur.", "success");
  refreshSupabasePanel();
}

function refreshSupabaseConfigPermissionState() {
  const form = $("#supabase-config-form");
  const permissionGuard = typeof guardSensitiveAction === "function"
    ? guardSensitiveAction("supabase.configure", {}, { notify: false })
    : { ok: false, message: "Configuration Supabase non autorisée." };
  if (form) {
    $$("input, button", form).forEach((control) => {
      control.disabled = !permissionGuard.ok;
      control.title = permissionGuard.message || "";
    });
  }
  const clearButton = $("#supabase-config-clear");
  if (clearButton) {
    clearButton.disabled = !permissionGuard.ok;
    clearButton.title = permissionGuard.message || "";
  }
  return permissionGuard;
}

let supabaseConfigFormBound = false;

function bindSupabaseConfigForm() {
  const form = $("#supabase-config-form");
  if (!supabaseConfigFormBound) {
    form?.addEventListener("submit", saveSupabaseRuntimeConfigFromForm);
    $("#supabase-config-clear")?.addEventListener("click", clearSupabaseRuntimeConfig);
    hydrateSupabaseConfigForm();
    supabaseConfigFormBound = true;
  }
  return refreshSupabaseConfigPermissionState();
}

async function submitSupabaseQualityReview({ caseId, status, reason = "", operationId = null } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false,
      code: "OFFLINE_NOT_ALLOWED",
      message: "Connexion internet requise pour enregistrer une décision de contrôle qualité.",
    };
  }
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, code: "NO_CLIENT", message: "Client Supabase non configuré." };
  }
  try {
    const authUser = await getSupabaseUser();
    if (!authUser?.id) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Utilisateur non authentifié." };
    }
    const workshopId = String(getSupabaseWorkshopId() || "").trim();
    const membershipResult = await resolveSupabaseWorkshopMembership(authUser);
    if (!membershipResult?.ok || !membershipResult.membership) {
      return {
        ok: false,
        code: membershipResult?.code || "INVALID_MEMBERSHIP",
        message: membershipResult?.message || "Appartenance atelier non valide.",
      };
    }
    const membership = membershipResult.membership;
    if (String(membership.user_id || "") !== String(authUser.id)
      || (workshopId && String(membership.workshop_id || "") !== workshopId)) {
      return {
        ok: false,
        code: "MEMBERSHIP_IDENTITY_MISMATCH",
        message: "L'appartenance atelier ne correspond pas à l'identité authentifiée.",
      };
    }
    const opId = String(operationId || "").trim();
    if (!opId) {
      return { ok: false, code: "OPERATION_ID_REQUIRED", message: "Identifiant d'opération qualité requis." };
    }
    const { data, error } = await client.rpc("nimr_apply_quality_review_v1", {
      p_workshop_id: workshopId,
      p_case_id: String(caseId || ""),
      p_quality_status: String(status || ""),
      p_reason: String(reason || ""),
      p_operation_id: opId,
    });
    if (error) {
      return { ok: false, code: error.code || "RPC_ERROR", message: error.message || "Erreur de validation qualité." };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: "EXCEPTION", message: err?.message || "Échec de l'appel RPC contrôle qualité." };
  }
}
window.submitSupabaseQualityReview = submitSupabaseQualityReview;
