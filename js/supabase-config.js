// Configuration Supabase NIMR SAV.
// Configuration zero-config pré-embarquée pour la production (clé publishable client uniquement).
// Ne jamais placer de clé administrative secrète dans cette application.
const SUPABASE_RUNTIME_CONFIG_KEY = "nimr-sav:supabase-runtime-config:v1";
const DEFAULT_WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_SUPABASE_URL = "https://mkecnwolvzgxltrasbmr.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_v1a1PN7erXlVLCSk3OqVqA_NJ4RX1-Y";

function readRuntimeSupabaseConfig() {
  try {
    return JSON.parse(localStorage.getItem(SUPABASE_RUNTIME_CONFIG_KEY) || "{}");
  } catch (error) {
    console.warn("Configuration Supabase locale illisible", error);
    return {};
  }
}

window.NIMR_SUPABASE_CONFIG = {
  enabled: true,
  url: DEFAULT_SUPABASE_URL,
  anonKey: DEFAULT_SUPABASE_ANON_KEY,
  workshopId: DEFAULT_WORKSHOP_ID,
  backupKey: "nimr-sav-main",
  backupTable: "cloud_backups",
  allowRuntimeConfig: true,
  ...readRuntimeSupabaseConfig(),
};

window.NIMR_SUPABASE_RUNTIME_CONFIG_KEY = SUPABASE_RUNTIME_CONFIG_KEY;
window.NIMR_DEFAULT_WORKSHOP_ID = DEFAULT_WORKSHOP_ID;
