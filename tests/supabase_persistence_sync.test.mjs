import assert from "node:assert/strict";

const config = {
  url: String(process.env.NIMR_SUPABASE_URL || "").replace(/\/+$/u, ""),
  anonKey: String(process.env.NIMR_SUPABASE_ANON_KEY || ""),
  email: String(process.env.NIMR_SUPABASE_TEST_EMAIL || ""),
  password: String(process.env.NIMR_SUPABASE_TEST_PASSWORD || ""),
  workshopId: String(process.env.NIMR_SUPABASE_TEST_WORKSHOP_ID || ""),
};

if (Object.values(config).some((value) => !value)) {
  console.log("SKIPPED — Supabase test environment not configured");
  process.exit(0);
}

assert.doesNotMatch(config.anonKey, /^sb_secret_|service[_-]?role/iu, "le test réel refuse toute clé service_role/secrète");

const authHeaders = { apikey: config.anonKey, "Content-Type": "application/json" };

async function login() {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `authentification Supabase test refusée (${response.status}): ${payload.error_description || payload.msg || "erreur"}`);
  assert.ok(payload.access_token && payload.user?.id, "token/utilisateur Supabase absent");
  return payload;
}

function restHeaders(token, prefer = "") {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

const backupKey = `codex-v2328-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const marker = `persistence-${crypto.randomUUID()}`;
let firstSession;
let secondSession;

try {
  firstSession = await login();
  const writeResponse = await fetch(`${config.url}/rest/v1/cloud_backups?on_conflict=workshop_id,backup_key`, {
    method: "POST",
    headers: restHeaders(firstSession.access_token, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      workshop_id: config.workshopId,
      backup_key: backupKey,
      app_version: "v23.2.8-full-audit",
      state: { testMarker: marker, cases: [], bookings: [], resources: [] },
      photos: [],
      cases_count: 0,
      photos_count: 0,
      updated_by: firstSession.user.id,
      updated_at: new Date().toISOString(),
    }),
  });
  const written = await writeResponse.json().catch(() => []);
  assert.equal(writeResponse.ok, true, `écriture cloud_backups refusée (${writeResponse.status})`);
  assert.equal(written[0]?.state?.testMarker, marker, "le serveur doit accuser le payload exact");

  await fetch(`${config.url}/auth/v1/logout`, { method: "POST", headers: restHeaders(firstSession.access_token) });
  secondSession = await login();

  const query = new URLSearchParams({
    select: "backup_key,state,app_version,workshop_id",
    workshop_id: `eq.${config.workshopId}`,
    backup_key: `eq.${backupKey}`,
  });
  const readResponse = await fetch(`${config.url}/rest/v1/cloud_backups?${query}`, { headers: restHeaders(secondSession.access_token) });
  const rows = await readResponse.json().catch(() => []);
  assert.equal(readResponse.ok, true, `relecture cloud_backups refusée (${readResponse.status})`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state?.testMarker, marker, "les données doivent survivre à logout/relogin Supabase");
  assert.equal(rows[0].workshop_id, config.workshopId, "l'isolation atelier doit être conservée");

  console.log("SUPABASE PERSISTENCE SYNC OK (ENVIRONNEMENT RÉEL)");
} finally {
  const token = secondSession?.access_token || firstSession?.access_token;
  if (token) {
    const cleanup = new URLSearchParams({ workshop_id: `eq.${config.workshopId}`, backup_key: `eq.${backupKey}` });
    await fetch(`${config.url}/rest/v1/cloud_backups?${cleanup}`, { method: "DELETE", headers: restHeaders(token) }).catch(() => null);
  }
}
