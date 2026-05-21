let nimrSupabaseClient = null;

function getSupabaseConfig() {
  return window.NIMR_SUPABASE_CONFIG || {};
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
  if (!isSupabaseConfigured()) {
    setSupabaseStatus("Supabase non configuré.", "error");
    setSupabaseDetails("Renseignez Project URL et anon public key dans js/supabase-config.js.");
    return;
  }
  if (!client) {
    setSupabaseStatus("Librairie Supabase non chargée.", "error");
    setSupabaseDetails("Vérifiez votre connexion internet ou le script CDN Supabase dans index.html.");
    return;
  }
  const user = await getSupabaseUser();
  if (user) {
    setSupabaseStatus(`Connecté : ${user.email || user.id}`, "ok");
    setSupabaseDetails("Synchronisation multi-PC active : les modifications sont sauvegardées et reçues depuis Supabase.");
  } else {
    setSupabaseStatus("Supabase configuré, utilisateur non connecté.", "warn");
    setSupabaseDetails("Connectez-vous avec l'utilisateur créé dans Authentication > Users.");
  }
}
