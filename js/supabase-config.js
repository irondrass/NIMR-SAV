// Configuration Supabase NIMR SAV.
// Aucune clé n'est publiée dans le code. Chaque poste configure l'URL et la clé
// anon publique depuis Paramètres > Cloud Supabase ; ces valeurs restent locales
// au navigateur. Ne jamais placer la clé service_role dans cette application.
const SUPABASE_RUNTIME_CONFIG_KEY = "nimr-sav:supabase-runtime-config:v1";
const DEFAULT_WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";

function readRuntimeSupabaseConfig() {
  try {
    return JSON.parse(localStorage.getItem(SUPABASE_RUNTIME_CONFIG_KEY) || "{}");
  } catch (error) {
    console.warn("Configuration Supabase locale illisible", error);
    return {};
  }
}

window.NIMR_SUPABASE_CONFIG = {
  enabled: false,
  url: "",
  anonKey: "",
  workshopId: DEFAULT_WORKSHOP_ID,
  backupKey: "nimr-sav-main",
  backupTable: "cloud_backups",
  allowRuntimeConfig: true,
  ...readRuntimeSupabaseConfig(),
};

window.NIMR_SUPABASE_RUNTIME_CONFIG_KEY = SUPABASE_RUNTIME_CONFIG_KEY;
window.NIMR_DEFAULT_WORKSHOP_ID = DEFAULT_WORKSHOP_ID;
