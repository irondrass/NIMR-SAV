let nimrSupabaseClient = null;
const NIMR_SUPABASE_PERSISTENT_SETUP_KEY = "nimr-auth-password-setup-required";
const NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY = "nimr-auth-activation-flow";
const NIMR_SUPABASE_AUTH_URL_KEYS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "token",
  "token_hash",
  "type",
  "code",
  "error",
  "error_code",
  "error_description",
];
let nimrSupabaseAuthUrlFlow = "";
let nimrSupabaseSessionRecovered = false;
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

function hasSupabaseAuthCallbackEvidence() {
  if (typeof window === "undefined" || typeof URL !== "function" || !window.location?.href) return false;
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(String(url.hash || "").replace(/^#/u, ""));
    return hash.has("access_token") && hash.has("refresh_token");
  } catch (error) {
    return false;
  }
}
window.hasSupabaseAuthCallbackEvidence = hasSupabaseAuthCallbackEvidence;

function detectSupabaseAuthUrlFlow() {
  if (!hasSupabaseAuthCallbackEvidence()) return "";
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(String(url.hash || "").replace(/^#/u, ""));
    const flowType = String(hash.get("type") || url.searchParams.get("type") || "").trim().toLowerCase();
    if (flowType === "recovery") return "recovery";
    if (["invite", "signup"].includes(flowType)) return "invitation";
  } catch (error) {
    return "";
  }
  return "";
}

function readPersistentPasswordSetupRequirement(userId = "") {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(NIMR_SUPABASE_PERSISTENT_SETUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const markerUserId = String(parsed.user_id || "").trim();
    const mode = String(parsed.mode || "").trim().toLowerCase();
    if (!markerUserId || !["recovery", "invitation"].includes(mode)) return null;
    if (userId && markerUserId !== String(userId).trim()) return null;
    return { user_id: markerUserId, mode };
  } catch (error) {
    return null;
  }
}
window.readPersistentPasswordSetupRequirement = readPersistentPasswordSetupRequirement;

function writePersistentPasswordSetupRequirement(userId, mode = "recovery") {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId || !["recovery", "invitation"].includes(mode)) return;
  if (typeof localStorage === "undefined") return;
  try {
    const marker = {
      user_id: cleanUserId,
      mode,
      created_at: new Date().toISOString(),
    };
    localStorage.setItem(NIMR_SUPABASE_PERSISTENT_SETUP_KEY, JSON.stringify(marker));
  } catch (error) {
    /* Ignorer si localStorage est indisponible */
  }
}
window.writePersistentPasswordSetupRequirement = writePersistentPasswordSetupRequirement;

function clearPersistentPasswordSetupRequirement(userId = "") {
  if (typeof localStorage === "undefined") return;
  try {
    if (!userId) {
      localStorage.removeItem(NIMR_SUPABASE_PERSISTENT_SETUP_KEY);
      return;
    }
    const current = readPersistentPasswordSetupRequirement(userId);
    if (current && current.user_id === String(userId).trim()) {
      localStorage.removeItem(NIMR_SUPABASE_PERSISTENT_SETUP_KEY);
    }
  } catch (error) {
    /* Aucun secret */
  }
}
window.clearPersistentPasswordSetupRequirement = clearPersistentPasswordSetupRequirement;

function readSupabaseAuthFlowSessionMarker(userId = "") {
  try {
    const raw = sessionStorage.getItem(NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return "";
    const markerUserId = String(parsed.user_id || "").trim();
    const mode = String(parsed.mode || "").trim().toLowerCase();
    if (!markerUserId || !["invitation", "recovery"].includes(mode)) return "";
    if (userId && markerUserId !== String(userId).trim()) return "";
    return mode;
  } catch (error) {
    return "";
  }
}

function writeSupabaseAuthFlowSessionMarker(userId, mode) {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId || !["invitation", "recovery"].includes(mode)) return;
  try {
    sessionStorage.setItem(NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY, JSON.stringify({
      user_id: cleanUserId,
      mode,
    }));
  } catch (error) {
    /* Mémoire uniquement si indisponible. */
  }
}

function clearSupabaseAuthFlowSessionMarker(userId = "") {
  try {
    if (!userId) {
      sessionStorage.removeItem(NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY);
      return;
    }
    const raw = sessionStorage.getItem(NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (String(parsed?.user_id || "").trim() === String(userId).trim()) {
      sessionStorage.removeItem(NIMR_SUPABASE_AUTH_FLOW_SESSION_KEY);
    }
  } catch (error) {
    /* Aucun secret à nettoyer. */
  }
}
window.clearSupabaseAuthFlowSessionMarker = clearSupabaseAuthFlowSessionMarker;

function clearSupabasePasswordSetupRequirement(userId = "") {
  nimrSupabaseAuthUrlFlow = "";
  clearSupabaseAuthFlowSessionMarker(userId);
  if (userId) clearPersistentPasswordSetupRequirement(userId);
}
window.clearSupabasePasswordSetupRequirement = clearSupabasePasswordSetupRequirement;

function cleanSensitiveSupabaseAuthUrlAfterSessionRecovery() {
  if (!nimrSupabaseSessionRecovered || !hasSupabaseAuthCallbackEvidence() || typeof URL !== "function" || !window.location?.href || !window.history?.replaceState) {
    return false;
  }
  try {
    const url = new URL(window.location.href);
    let changed = false;
    NIMR_SUPABASE_AUTH_URL_KEYS.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });

    const rawHash = String(url.hash || "").replace(/^#/u, "");
    const hashParams = new URLSearchParams(rawHash);
    const authHash = NIMR_SUPABASE_AUTH_URL_KEYS.some((key) => hashParams.has(key));
    if (authHash) {
      NIMR_SUPABASE_AUTH_URL_KEYS.forEach((key) => hashParams.delete(key));
      const remainingHash = hashParams.toString();
      url.hash = remainingHash ? `#${remainingHash}` : "";
      changed = true;
    }
    if (!changed) return false;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch (error) {
    return false;
  }
}
window.cleanSensitiveSupabaseAuthUrlAfterSessionRecovery = cleanSensitiveSupabaseAuthUrlAfterSessionRecovery;

function markSupabaseAuthSessionRecovered(event, session) {
  if (!session?.user?.id) return "";
  nimrSupabaseSessionRecovered = true;
  const eventName = String(event || "").trim().toUpperCase();
  const userId = String(session.user.id).trim();
  let mode = "";
  if (eventName === "PASSWORD_RECOVERY") {
    mode = "recovery";
    writePersistentPasswordSetupRequirement(userId, "recovery");
  } else {
    const persistent = readPersistentPasswordSetupRequirement(userId);
    mode = (persistent && persistent.mode) || nimrSupabaseAuthUrlFlow || readSupabaseAuthFlowSessionMarker(userId);
    if (mode === "recovery") {
      writePersistentPasswordSetupRequirement(userId, "recovery");
    }
  }
  if (mode) writeSupabaseAuthFlowSessionMarker(userId, mode);
  cleanSensitiveSupabaseAuthUrlAfterSessionRecovery();
  return mode;
}
window.markSupabaseAuthSessionRecovered = markSupabaseAuthSessionRecovered;

function getSupabasePasswordSetupMode(user) {
  const userId = String(user?.id || "").trim();
  if (userId) {
    const persistentMarker = readPersistentPasswordSetupRequirement(userId);
    if (persistentMarker?.mode) return persistentMarker.mode;
  }
  const sessionMode = readSupabaseAuthFlowSessionMarker(userId);
  if (sessionMode) return sessionMode;
  if (user?.user_metadata?.nimr_password_setup_required === true) return "invitation";
  return "";
}
window.getSupabasePasswordSetupMode = getSupabasePasswordSetupMode;

function isSupabasePasswordSetupRequired(user) {
  return Boolean(getSupabasePasswordSetupMode(user));
}
window.isSupabasePasswordSetupRequired = isSupabasePasswordSetupRequired;

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
    nimrSupabaseAuthUrlFlow = detectSupabaseAuthUrlFlow();
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
  const user = data?.user || null;
  if (user?.id) markSupabaseAuthSessionRecovered("USER_RECOVERED", { user });
  return user;
}

async function getSupabaseSessionPasswordSetupMode() {
  const client = getSupabaseClient();
  if (!client?.auth?.getSession) return "";
  try {
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    if (error || !session?.user?.id) return "";
    markSupabaseAuthSessionRecovered("SESSION_RECOVERED", session);
    return getSupabasePasswordSetupMode(session.user);
  } catch (error) {
    return "";
  }
}
window.getSupabaseSessionPasswordSetupMode = getSupabaseSessionPasswordSetupMode;

function getCurrentSupabaseApplicationBaseUrl() {
  if (typeof URL !== "function" || !window.location?.href) return "";
  try {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/[^/]*$/u, "/");
    }
    return url.href;
  } catch (error) {
    return "";
  }
}
window.getCurrentSupabaseApplicationBaseUrl = getCurrentSupabaseApplicationBaseUrl;

async function requestSupabasePasswordRecovery(email) {
  const client = getSupabaseClient();
  if (!client?.auth?.resetPasswordForEmail) {
    return { ok: false, code: "NO_CLIENT", message: "Service de récupération Supabase indisponible." };
  }
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(cleanEmail)) {
    return { ok: false, code: "INVALID_EMAIL", message: "Saisissez une adresse email valide." };
  }
  const redirectTo = getCurrentSupabaseApplicationBaseUrl();
  if (!redirectTo) {
    return { ok: false, code: "INVALID_REDIRECT", message: "Adresse de retour de l’application indisponible." };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
    if (error) {
      return { ok: false, code: "RECOVERY_REQUEST_FAILED", message: error.message || "Envoi du code impossible." };
    }
    return {
      ok: true,
      message: "Si ce compte existe, un code de récupération vient d’être envoyé.",
    };
  } catch (error) {
    return { ok: false, code: "RECOVERY_REQUEST_FAILED", message: error?.message || "Envoi du code impossible." };
  }
}
window.requestSupabasePasswordRecovery = requestSupabasePasswordRecovery;

async function verifySupabaseRecoveryOtp(email, token) {
  const client = getSupabaseClient();
  if (!client?.auth?.verifyOtp || !client.auth?.getUser) {
    return { ok: false, code: "NO_CLIENT", message: "Service de vérification Supabase indisponible." };
  }
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(cleanEmail)) {
    return { ok: false, code: "INVALID_EMAIL", message: "Saisissez une adresse email valide." };
  }
  const cleanToken = String(token || "").replace(/\s+/gu, "");
  if (!/^\d{6}$/u.test(cleanToken)) {
    return { ok: false, code: "INVALID_OTP", message: "Saisissez le code de récupération à 6 chiffres." };
  }

  window.__nimrRecoveryOtpVerificationPending = true;
  try {
    const { data, error } = await client.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: "recovery",
    });
    const session = data?.session;
    const verifiedUser = data?.user || session?.user;
    if (
      error
      || !session?.user?.id
      || !verifiedUser?.id
      || String(verifiedUser.id) !== String(session.user.id)
    ) {
      return {
        ok: false,
        code: "RECOVERY_OTP_REJECTED",
        message: "Code invalide ou expiré. Demandez un nouveau code.",
      };
    }

    if (typeof markSupabaseAuthSessionRecovered === "function") {
      markSupabaseAuthSessionRecovered("PASSWORD_RECOVERY", session);
    } else {
      writePersistentPasswordSetupRequirement(verifiedUser.id, "recovery");
      writeSupabaseAuthFlowSessionMarker(verifiedUser.id, "recovery");
    }

    const { data: currentData, error: currentError } = await client.auth.getUser();
    const currentUser = currentData?.user;
    if (
      currentError
      || !currentUser?.id
      || String(currentUser.id) !== String(verifiedUser.id)
    ) {
      if (currentUser?.id) {
        writePersistentPasswordSetupRequirement(currentUser.id, "recovery");
        writeSupabaseAuthFlowSessionMarker(currentUser.id, "recovery");
      }
      return {
        ok: false,
        code: "AUTH_REVALIDATION_FAILED",
        message: "La session de récupération n’a pas pu être confirmée.",
      };
    }

    return { ok: true, user: currentUser };
  } catch (error) {
    return {
      ok: false,
      code: "RECOVERY_OTP_FAILED",
      message: "Code invalide ou expiré. Demandez un nouveau code.",
    };
  } finally {
    window.__nimrRecoveryOtpVerificationPending = false;
  }
}
window.verifySupabaseRecoveryOtp = verifySupabaseRecoveryOtp;

async function completeSupabasePasswordSetup(password) {
  const newPassword = String(password || "");
  if (newPassword.length < 10) {
    return { ok: false, code: "WEAK_PASSWORD", message: "Le mot de passe doit contenir au moins 10 caractères." };
  }
  const client = getSupabaseClient();
  if (!client?.auth?.getSession || !client.auth?.updateUser || !client.auth?.getUser) {
    return { ok: false, code: "NO_CLIENT", message: "Service d’activation Supabase indisponible." };
  }
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.user?.id) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Le lien n’a pas établi de session valide. Demandez un nouveau lien." };
    }
    const { data: currentData, error: currentError } = await client.auth.getUser();
    const currentUser = currentData?.user;
    if (currentError || !currentUser?.id || currentUser.id !== sessionData.session.user.id) {
      return { ok: false, code: "UNAUTHENTICATED", message: "La session d’activation n’est plus valide." };
    }
    const existingMetadata = currentUser.user_metadata && typeof currentUser.user_metadata === "object"
      ? currentUser.user_metadata
      : {};
    const { error: updateError } = await client.auth.updateUser({
      password: newPassword,
      data: {
        ...existingMetadata,
        nimr_password_setup_required: false,
        nimr_password_setup_completed_at: new Date().toISOString(),
      },
    });
    if (updateError) {
      return { ok: false, code: "PASSWORD_UPDATE_FAILED", message: updateError.message || "Mise à jour du mot de passe refusée." };
    }

    const { data: confirmedData, error: confirmedError } = await client.auth.getUser();
    const confirmedUser = confirmedData?.user;
    if (confirmedError || !confirmedUser?.id || confirmedUser.id !== currentUser.id) {
      return { ok: false, code: "AUTH_REVALIDATION_FAILED", message: "Impossible de confirmer l’identité après activation." };
    }
    const membershipResult = await resolveSupabaseWorkshopMembership(confirmedUser);
    if (!membershipResult?.ok || !membershipResult.membership) {
      return {
        ok: false,
        code: membershipResult?.code || "MEMBERSHIP_DENIED",
        message: membershipResult?.message || "Aucune appartenance atelier active n’autorise ce compte.",
      };
    }
    clearSupabasePasswordSetupRequirement(confirmedUser.id);
    return { ok: true, user: confirmedUser, membership: membershipResult.membership };
  } catch (error) {
    return { ok: false, code: "PASSWORD_SETUP_FAILED", message: error?.message || "Activation du compte impossible." };
  }
}
window.completeSupabasePasswordSetup = completeSupabasePasswordSetup;

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
    markSupabaseAuthSessionRecovered("SIGNED_IN", data.session || { user: data.user });
    const passwordSetupMode = getSupabasePasswordSetupMode(data.user);
    if (passwordSetupMode) {
      return { ok: true, user: data.user, passwordSetupRequired: true, passwordSetupMode };
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
  let signingOutUserId = "";
  try {
    const { data } = typeof client.auth.getSession === "function"
      ? await client.auth.getSession()
      : { data: null };
    signingOutUserId = String(data?.session?.user?.id || "").trim();
  } catch (error) {
    signingOutUserId = "";
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
    clearSupabasePasswordSetupRequirement(signingOutUserId);
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
    const passwordSetupMode = getSupabasePasswordSetupMode(user);
    if (passwordSetupMode) {
      setSupabaseStatus("Activation du compte requise.", "warn");
      setSupabaseDetails("Choisissez votre mot de passe puis l’appartenance atelier sera de nouveau vérifiée avant l’accès.");
      return;
    }
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
