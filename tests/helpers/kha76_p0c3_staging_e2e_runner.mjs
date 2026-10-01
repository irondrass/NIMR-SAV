import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { withBrowserPage } from "./cdp_browser_harness.mjs";

export const EXPECTED_PROJECT_REF = "ijgstcdptyxjzgqlvooc";
export const EXPECTED_STAGING_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
export const EXPECTED_APP_VERSION = "v23.3.71";
export const RUNTIME_CONFIG_KEY = "nimr-sav:supabase-runtime-config:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function classifyAuthError(message = "") {
  const text = String(message).toLowerCase();
  if (text.includes("rate limit")) return "AUTH_BLOCKED";
  if (text.includes("email not confirmed")) return "AUTH_CONFIRMATION_REQUIRED";
  if (text.includes("invalid login") || text.includes("invalid credentials")) return "AUTH_INVALID";
  return "AUTH_FAILED";
}

export function validateConfig(input) {
  const config = { ...input };
  const missing = ["url", "anonKey", "workshopId", "email", "password"]
    .filter((key) => !String(config[key] || "").trim());
  if (missing.length) return { ok: false, status: "CONFIG_MISSING", missing };
  if (String(config.url).replace(/\/+$/u, "") !== EXPECTED_STAGING_URL) {
    return { ok: false, status: "STAGING_URL_REJECTED" };
  }
  if (/^sb_secret_|service[_-]?role/iu.test(String(config.anonKey))) {
    return { ok: false, status: "SECRET_KEY_REJECTED" };
  }
  if (!UUID_RE.test(String(config.workshopId))) {
    return { ok: false, status: "WORKSHOP_ID_REJECTED" };
  }
  config.authMode = String(config.authMode || "existing").trim().toLowerCase();
  if (!["existing", "signup"].includes(config.authMode)) {
    return { ok: false, status: "AUTH_MODE_REJECTED" };
  }
  config.repairOrderId = String(config.repairOrderId || "").trim();
  config.repairOrderNumber = String(config.repairOrderNumber || "").trim();
  if (config.repairOrderId && !UUID_RE.test(config.repairOrderId)) {
    return { ok: false, status: "REPAIR_ORDER_ID_REJECTED" };
  }
  return { ok: true, config };
}

export function buildPreloadScript(config) {
  const runtime = {
    enabled: true,
    url: EXPECTED_STAGING_URL,
    anonKey: config.anonKey,
    workshopId: config.workshopId,
    backupKey: "kha76-p0c3-e2e",
    backupTable: "cloud_backups",
    allowRuntimeConfig: false,
  };
  return `localStorage.setItem(${JSON.stringify(RUNTIME_CONFIG_KEY)}, ${JSON.stringify(JSON.stringify(runtime))});`;
}

function emit(status, details = {}) {
  const payload = {
    task: "KHA-76 P0c.3 STAGING E2E",
    status,
    at: new Date().toISOString(),
    ...details,
  };
  console.log(JSON.stringify(payload));
  return payload;
}
function browserAuthExpression(config) {
  const authCall = config.authMode === "signup"
    ? `client.auth.signUp({ email: ${JSON.stringify(config.email)}, password: ${JSON.stringify(config.password)} })`
    : `client.auth.signInWithPassword({ email: ${JSON.stringify(config.email)}, password: ${JSON.stringify(config.password)} })`;
  return `(async () => {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: "NO_SUPABASE_CLIENT" };
    const { data, error } = await ${authCall};
    return {
      ok: !error,
      error: error?.message || "",
      userId: data?.user?.id || null,
      session: Boolean(data?.session),
      emailConfirmed: Boolean(data?.user?.email_confirmed_at),
    };
  })()`;
}

function membershipExpression() {
  return `(async () => {
    const user = await getSupabaseUser();
    if (!user?.id) return { ok: false, code: "NO_AUTH_USER" };
    const result = await resolveSupabaseWorkshopMembership(user);
    return {
      ok: Boolean(result?.ok),
      code: result?.code || "",
      message: result?.message || "",
      userId: user.id,
      membership: result?.membership || null,
    };
  })()`;
}

function repairOrderExpression(config) {
  const byId = config.repairOrderId
    ? `.eq("id", ${JSON.stringify(config.repairOrderId)})`
    : `.eq("order_number", ${JSON.stringify(config.repairOrderNumber)})`;
  return `(async () => {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: "NO_SUPABASE_CLIENT" };
    const { data, error } = await client
      .from("repair_orders")
      .select("id,workshop_id,order_number,status")
      .eq("workshop_id", getSupabaseWorkshopId())
      ${byId}
      .maybeSingle();
    return {
      ok: !error && Boolean(data?.id),
      error: error?.message || "",
      row: data || null,
    };
  })()`;
}

function e2eClaimExpression(order) {
  return `(async () => {
    const client = getSupabaseClient();
    const stamp = Date.now();
    const localId = "kha76-p0c3-e2e-" + stamp;
    const now = new Date().toISOString();
    const row = {
      local_id: localId,
      repair_order_id: ${JSON.stringify(order.id)},
      number: "W-E2E-" + stamp,
      title: "KHA-76 P0c.3 E2E",
      vehicle_area: "STAGING",
      type: "garantie",
      status: "draft",
      include_in_planning: true,
      expert_approved: false,
      client_approved: false,
      estimate_number: null,
      or_number: ${JSON.stringify(order.order_number || "")},
      amount: null,
      source_file: null,
      created_at: now,
      updated_at: now,
    };
    const createdMap = await upsertLegacyRepairClaims(client, [row]);
    const claimId = createdMap.get(localId) || null;
    if (!claimId) return { ok: false, stage: "rpc-create", localId };

    const createdRead = await client
      .from("repair_claims")
      .select("id,local_id,title,status,expert_approved,client_approved,repair_order_id,workshop_id")
      .eq("workshop_id", getSupabaseWorkshopId())
      .eq("local_id", localId)
      .maybeSingle();
    if (createdRead.error || !createdRead.data?.id) {
      return { ok: false, stage: "select-created", localId, claimId, error: createdRead.error?.message || "" };
    }

    const updatedRow = { ...row, title: "KHA-76 P0c.3 E2E UPDATED", updated_at: new Date().toISOString() };
    const updatedMap = await upsertLegacyRepairClaims(client, [updatedRow]);
    if (updatedMap.get(localId) !== claimId) {
      return { ok: false, stage: "rpc-safe-update", localId, claimId };
    }

    const directLocalId = localId + "-direct";
    const directInsert = await client.from("repair_claims").insert([{
      ...row, local_id: directLocalId, workshop_id: getSupabaseWorkshopId(),
    }]).select("id").maybeSingle();
    const directUpdate = await client.from("repair_claims")
      .update({ title: "DIRECT UPDATE MUST FAIL" }).eq("id", claimId);
    const directDelete = await client.from("repair_claims").delete().eq("id", claimId);

    let forgeError = "";
    try {
      await upsertLegacyRepairClaims(client, [{ ...updatedRow, status: "approved" }]);
    } catch (error) {
      forgeError = String(error?.message || error || "");
    }
    const finalRead = await client
      .from("repair_claims")
      .select("id,local_id,title,status,expert_approved,client_approved")
      .eq("workshop_id", getSupabaseWorkshopId())
      .eq("id", claimId)
      .maybeSingle();

    return {
      ok: !finalRead.error
        && finalRead.data?.title === "KHA-76 P0c.3 E2E UPDATED"
        && finalRead.data?.status === "draft"
        && finalRead.data?.expert_approved === false
        && finalRead.data?.client_approved === false
        && Boolean(directInsert.error)
        && Boolean(directUpdate.error)
        && Boolean(directDelete.error)
        && /P0C3_STATUS_CHANGE_FORBIDDEN/u.test(forgeError),
      stage: "complete",
      localId,
      claimId,
      directLocalId,
      directInsertId: directInsert.data?.id || null,
      directInsertBlocked: Boolean(directInsert.error),
      directUpdateBlocked: Boolean(directUpdate.error),
      directDeleteBlocked: Boolean(directDelete.error),
      forgeBlocked: /P0C3_STATUS_CHANGE_FORBIDDEN/u.test(forgeError),
      finalRow: finalRead.data || null,
    };
  })()`;
}

export function configFromEnv(env = process.env) {
  return {
    url: env.NIMR_KHA76_STAGING_URL || EXPECTED_STAGING_URL,
    anonKey: env.NIMR_KHA76_STAGING_KEY || "",
    workshopId: env.NIMR_KHA76_TEST_WORKSHOP_ID || "",
    email: env.NIMR_KHA76_TEST_EMAIL || "",
    password: env.NIMR_KHA76_TEST_PASSWORD || "",
    authMode: env.NIMR_KHA76_AUTH_MODE || "existing",
    repairOrderId: env.NIMR_KHA76_TEST_REPAIR_ORDER_ID || "",
    repairOrderNumber: env.NIMR_KHA76_TEST_REPAIR_ORDER_NUMBER || "",
  };
}

export async function runKha76P0c3StagingE2E(input = configFromEnv()) {
  const checked = validateConfig(input);
  if (!checked.ok) return emit(checked.status, { missing: checked.missing || [] });
  const config = checked.config;
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  try {
    return await withBrowserPage(repoRoot, async ({ evaluate, findings }) => {
      const bootstrap = await evaluate(`JSON.stringify({
        version: window.APP_VERSION || "",
        url: window.NIMR_SUPABASE_CONFIG?.url || "",
        workshopId: window.NIMR_SUPABASE_CONFIG?.workshopId || "",
        rpcHelper: typeof upsertLegacyRepairClaims,
        clientFactory: typeof getSupabaseClient,
      })`);
      const runtime = JSON.parse(bootstrap);
      assert.equal(runtime.version, EXPECTED_APP_VERSION, "version PWA STAGING inattendue");
      assert.equal(runtime.url, EXPECTED_STAGING_URL, "le navigateur ne pointe pas STAGING");
      assert.equal(runtime.workshopId, config.workshopId, "atelier runtime inattendu");
      assert.equal(runtime.rpcHelper, "function", "helper P0c.3 absent");
      assert.equal(runtime.clientFactory, "function", "client Supabase absent");

      const auth = await evaluate(browserAuthExpression(config));
      if (!auth?.ok) {
        return emit(classifyAuthError(auth?.error), {
          authMode: config.authMode,
          error: auth?.error || "unknown auth error",
        });
      }
      if (!auth.session) {
        return emit("AUTH_CONFIRMATION_REQUIRED", { authMode: config.authMode, userId: auth.userId || null });
      }

      const membership = await evaluate(membershipExpression());
      if (!membership?.ok) {
        await evaluate(`getSupabaseClient()?.auth?.signOut?.()`);
        return emit("FIXTURE_REQUIRED", {
          fixture: "membership",
          userId: membership?.userId || auth.userId || null,
          workshopId: config.workshopId,
          membershipCode: membership?.code || "",
        });
      }

      if (!config.repairOrderId && !config.repairOrderNumber) {
        await evaluate(`getSupabaseClient()?.auth?.signOut?.()`);
        return emit("FIXTURE_REQUIRED", {
          fixture: "repair_order",
          userId: auth.userId || null,
          workshopId: config.workshopId,
        });
      }

      const order = await evaluate(repairOrderExpression(config));
      if (!order?.ok || !order?.row?.id) {
        await evaluate(`getSupabaseClient()?.auth?.signOut?.()`);
        return emit("FIXTURE_REQUIRED", {
          fixture: "repair_order",
          userId: auth.userId || null,
          workshopId: config.workshopId,
          error: order?.error || "",
        });
      }

      const result = await evaluate(e2eClaimExpression(order.row));
      await evaluate(`getSupabaseClient()?.auth?.signOut?.()`);
      if (!result?.ok) {
        return emit("FAIL", {
          stage: result?.stage || "claim-e2e",
          result: result || null,
          findings,
        });
      }

      return emit("PASS", {
        userId: auth.userId || null,
        workshopId: config.workshopId,
        repairOrderId: order.row.id,
        claimId: result.claimId,
        claimLocalId: result.localId,
        directInsertBlocked: result.directInsertBlocked,
        directUpdateBlocked: result.directUpdateBlocked,
        directDeleteBlocked: result.directDeleteBlocked,
        forgeBlocked: result.forgeBlocked,
        cleanup: {
          repairClaimIds: [result.claimId, result.directInsertId].filter(Boolean),
          repairClaimLocalIds: [result.localId, result.directLocalId].filter(Boolean),
        },
      });
    }, {
      preloadScript: buildPreloadScript(config),
      startupTimeoutMs: 30_000,
    });
  } catch (error) {
    return emit("FAIL", { stage: "harness", error: String(error?.message || error || "") });
  }
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = await runKha76P0c3StagingE2E();
  const nonFailing = new Set([
    "PASS", "AUTH_BLOCKED", "AUTH_CONFIRMATION_REQUIRED",
    "FIXTURE_REQUIRED", "CONFIG_MISSING",
  ]);
  process.exitCode = nonFailing.has(result.status) ? 0 : 1;
}
