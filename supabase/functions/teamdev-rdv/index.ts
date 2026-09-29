import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const TEAMDEV_API_BASE = "https://bo.nimr.com.tn/api/1.0.0";
const TEAMDEV_PAGE_SIZE = 100;
const TEAMDEV_MAX_PAGES = 10;
const ALLOWED_ROLES = new Set(["admin_technique", "directeur", "chef_atelier", "reception"]);

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function failure(code, message, status = 400) {
  return response({ ok: false, code, message }, status);
}

function cleanText(value, limit = 512) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, limit)
    : "";
}
function readPublishableKey(environment) {
  const dictionary = environment.get("SUPABASE_PUBLISHABLE_KEYS");
  if (dictionary !== undefined) {
    try {
      const parsed = JSON.parse(dictionary);
      const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed.default
        : "";
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }
  return String(environment.get("SUPABASE_PUBLISHABLE_KEY") || "").trim();
}

function parseRequestBody(request) {
  return request.json()
    .then((value) => value && typeof value === "object" && !Array.isArray(value) ? value : null)
    .catch(() => null);
}

function datePartsInTunisia(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseIsoDay(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return "";
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10) === text ? text : "";
}

function validateDateRange(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  return (end - start) / 86400000 <= 7;
}

function readWorkspaceBindings(environment, workshopId) {
  const raw = String(environment.get("TEAMDEV_WORKSPACE_BINDINGS") || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed[workshopId]
      : null;
    const list = Array.isArray(value) ? value : [value];
    return [...new Set(list.map((item) => cleanText(item, 128)).filter(Boolean))];
  } catch {
    return [];
  }
}

function extractArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function extractWorkspaces(payload) {
  return extractArray(payload, ["userWorkspaces", "workspaces"])
    .concat(Array.isArray(payload?.result?.userWorkspaces) ? payload.result.userWorkspaces : [])
    .concat(Array.isArray(payload?.result?.workspaces) ? payload.result.workspaces : [])
    .concat(Array.isArray(payload?.result) ? payload.result : []);
}

function safeNumber(value) {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sanitizePhones(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const candidate = typeof entry === "string" || typeof entry === "number"
      ? entry
      : entry?.number;
    const number = cleanText(
      typeof candidate === "number" && Number.isFinite(candidate) ? String(candidate) : candidate,
      80,
    );
    if (number) result.push({ number });
  }
  return result.slice(0, 5);
}

function sanitizeAppointment(value) {
  const raw = value && typeof value === "object" ? value : {};
  const intervention = raw.intervention && typeof raw.intervention === "object"
    ? raw.intervention
    : {};
  const service = intervention.service && typeof intervention.service === "object"
    ? intervention.service
    : {};
  const abstractService = service.abstractService && typeof service.abstractService === "object"
    ? service.abstractService
    : {};
  const vehicle = intervention.vehicle && typeof intervention.vehicle === "object"
    ? intervention.vehicle
    : {};
  const version = vehicle.version && typeof vehicle.version === "object" ? vehicle.version : {};
  const model = version.model && typeof version.model === "object" ? version.model : {};
  const client = vehicle.client && typeof vehicle.client === "object" ? vehicle.client : {};
  const id = cleanText(raw.id, 128);
  const interventionId = cleanText(intervention.id, 128);
  if (!id || !interventionId) return null;

  return {
    id,
    date: cleanText(raw.date, 80),
    status: cleanText(raw.status, 80),
    updatedAt: cleanText(raw.updatedAt, 80),
    intervention: {
      id: interventionId,
      status: cleanText(intervention.status, 80),
      requestedDate: cleanText(intervention.requestedDate, 80),
      description: cleanText(intervention.description, 2000),
      km: safeNumber(intervention.km),
      vehicleId: cleanText(intervention.vehicleId, 128),
      serviceId: cleanText(intervention.serviceId, 128),
      service: {
        id: cleanText(service.id, 128),
        abstractServiceId: cleanText(service.abstractServiceId, 128),
        agencyId: cleanText(service.agencyId, 128),
        brandId: cleanText(service.brandId, 128),
        abstractService: {
          id: cleanText(abstractService.id, 128),
          name: cleanText(abstractService.name, 256),
        },
      },
      vehicle: {
        id: cleanText(vehicle.id, 128),
        clientId: cleanText(vehicle.clientId, 128),
        chassisNumber: cleanText(vehicle.chassisNumber, 128),
        registrationNumber: cleanText(vehicle.registrationNumber, 80),
        name: cleanText(vehicle.name, 256),
        brandName: cleanText(vehicle.brandName, 128),
        version: {
          version: cleanText(version.version, 128),
          model: { title: cleanText(model.title, 256) },
        },
        client: {
          id: cleanText(client.id, 128),
          firstName: cleanText(client.firstName, 160),
          lastName: cleanText(client.lastName, 160),
          socialReason: cleanText(client.socialReason, 256),
          phones: sanitizePhones(client.phones),
        },
      },
    },
  };
}

class TeamdevUpstreamError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "TeamdevUpstreamError";
    this.code = code;
    this.status = status;
  }
}

async function fetchJson(fetchFn, url, options, errorCode) {
  let result;
  const requestOptions = { ...options };
  if (!requestOptions.signal
    && typeof AbortSignal !== "undefined"
    && typeof AbortSignal.timeout === "function") {
    requestOptions.signal = AbortSignal.timeout(8000);
  }
  try {
    result = await fetchFn(url, requestOptions);
  } catch {
    throw new TeamdevUpstreamError(errorCode, 502);
  }
  if (!result?.ok) {
    throw new TeamdevUpstreamError(errorCode, 502);
  }
  try {
    return await result.json();
  } catch {
    throw new TeamdevUpstreamError("TEAMDEV_INVALID_RESPONSE", 502);
  }
}

function teamdevHeaders(token = "") {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function appendServices(params, services) {
  for (const id of services) params.append("services", id);
  return params;
}

async function resolveCaller(clientFactory, supabaseUrl, publishableKey, jwt, workshopId) {
  const client = clientFactory(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(jwt);
  const user = authData?.user;
  if (authError || !user?.id) {
    return { ok: false, response: failure("UNAUTHENTICATED", "Identité Supabase invalide ou expirée.", 401) };
  }

  const { data: membership, error: membershipError } = await client
    .from("workshop_members")
    .select("workshop_id, user_id, role")
    .eq("workshop_id", workshopId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (membershipError || !membership) {
    return { ok: false, response: failure("FORBIDDEN_RDV_READ", "Accès aux rendez-vous non autorisé.", 403) };
  }
  const role = cleanText(membership.role, 80);
  if (String(membership.workshop_id || "") !== workshopId
    || String(membership.user_id || "") !== String(user.id)
    || !ALLOWED_ROLES.has(role)) {
    return { ok: false, response: failure("FORBIDDEN_RDV_READ", "Accès aux rendez-vous non autorisé.", 403) };
  }
  return { ok: true, user, membership };
}

async function loginTeamdev(fetchFn, username, password) {
  const payload = await fetchJson(
    fetchFn,
    `${TEAMDEV_API_BASE}/backoffice/auth/signin`,
    {
      method: "POST",
      headers: { ...teamdevHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    "TEAMDEV_AUTH_FAILED",
  );
  const token = cleanText(payload?.access_token, 4096);
  if (!token) throw new TeamdevUpstreamError("TEAMDEV_AUTH_FAILED", 502);
  return token;
}

async function loadTeamdevWorkspaces(fetchFn, token, workspaceIds) {
  const payload = await fetchJson(
    fetchFn,
    `${TEAMDEV_API_BASE}/backoffice/users/me`,
    { method: "GET", headers: teamdevHeaders(token) },
    "TEAMDEV_WORKSPACES_FAILED",
  );
  const all = extractWorkspaces(payload);
  const byId = new Map(
    all
      .filter((item) => item && typeof item === "object")
      .map((item) => [cleanText(item.id, 128), item]),
  );
  const selected = workspaceIds.map((id) => byId.get(id)).filter(Boolean);
  if (selected.length !== workspaceIds.length) {
    throw new TeamdevUpstreamError("TEAMDEV_WORKSPACE_NOT_AVAILABLE", 502);
  }
  return selected;
}

async function loadServices(fetchFn, token, workspace) {
  const brandId = cleanText(workspace.brandId, 128);
  const agencyId = cleanText(workspace.agencyId, 128);
  if (!brandId || !agencyId) {
    throw new TeamdevUpstreamError("TEAMDEV_WORKSPACE_INVALID", 502);
  }
  const params = new URLSearchParams({ brand: brandId, agency: agencyId });
  const payload = await fetchJson(
    fetchFn,
    `${TEAMDEV_API_BASE}/backoffice/services?${params}`,
    { method: "GET", headers: teamdevHeaders(token) },
    "TEAMDEV_SERVICES_FAILED",
  );
  return extractArray(payload, ["result", "services"])
    .filter((item) => item && typeof item === "object" && item.isAvailable !== false)
    .map((item) => cleanText(item.id, 128))
    .filter(Boolean);
}

async function loadAppointments(fetchFn, token, workspace, serviceIds, startDate, endDate) {
  if (!serviceIds.length) return [];
  const rows = [];
  const brandName = cleanText(workspace.brandName, 80);

  for (let page = 1; page <= TEAMDEV_MAX_PAGES; page += 1) {
    const params = appendServices(
      new URLSearchParams({
        page: String(page),
        pageSize: String(TEAMDEV_PAGE_SIZE),
        order: "DESC",
        startDate,
        endDate,
      }),
      serviceIds,
    );
    if (brandName) params.set("brandName", brandName);
    const payload = await fetchJson(
      fetchFn,
      `${TEAMDEV_API_BASE}/backoffice/interventions/appointments?${params}`,
      { method: "GET", headers: teamdevHeaders(token) },
      "TEAMDEV_APPOINTMENTS_FAILED",
    );
    const pageRows = extractArray(payload, ["result", "appointments"]);
    rows.push(...pageRows);
    if (pageRows.length < TEAMDEV_PAGE_SIZE) break;
    if (page === TEAMDEV_MAX_PAGES) {
      throw new TeamdevUpstreamError("TEAMDEV_APPOINTMENTS_LIMIT", 502);
    }
  }
  return rows;
}

function dedupeAppointments(rows) {
  const result = [];
  const seen = new Set();
  for (const item of rows) {
    const normalized = sanitizeAppointment(item);
    if (!normalized) continue;
    const key = normalized.id || normalized.intervention?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function createTeamdevRdvHandler(overrides = {}) {
  const environment = overrides.environment || Deno.env;
  const clientFactory = overrides.clientFactory || createClient;
  const fetchFn = overrides.fetchFn || fetch;
  const now = overrides.now || (() => new Date());

  return async function teamdevRdv(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (request.method !== "POST") {
      return failure("METHOD_NOT_ALLOWED", "Méthode non autorisée.", 405);
    }

    const authorization = String(request.headers.get("Authorization") || "").trim();
    const jwt = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() || "";
    if (!jwt) return failure("UNAUTHENTICATED", "Jeton utilisateur Supabase requis.", 401);

    const body = await parseRequestBody(request);
    if (!body) return failure("INVALID_REQUEST", "Corps JSON invalide.");

    const workshopId = cleanText(body.workshop_id, 128);
    if (!workshopId) return failure("WORKSHOP_REQUIRED", "Atelier requis.");

    const today = datePartsInTunisia(now());
    const startDate = parseIsoDay(body.start_date) || today;
    const endDate = parseIsoDay(body.end_date) || startDate;
    if (!validateDateRange(startDate, endDate)) {
      return failure("INVALID_DATE_RANGE", "Période RDV invalide ou supérieure à 7 jours.");
    }
    const supabaseUrl = String(environment.get("SUPABASE_URL") || "").trim();
    const publishableKey = readPublishableKey(environment);
    const username = String(environment.get("TEAMDEV_USERNAME") || "").trim();
    const password = String(environment.get("TEAMDEV_PASSWORD") || "");
    const workspaceIds = readWorkspaceBindings(environment, workshopId);

    if (!supabaseUrl || !publishableKey || !username || !password || !workspaceIds.length) {
      return failure("SERVER_CONFIGURATION_ERROR", "Configuration serveur Teamdev indisponible.", 503);
    }

    const caller = await resolveCaller(
      clientFactory,
      supabaseUrl,
      publishableKey,
      jwt,
      workshopId,
    );
    if (!caller.ok) return caller.response;

    try {
      const token = await loginTeamdev(fetchFn, username, password);
      const workspaces = await loadTeamdevWorkspaces(fetchFn, token, workspaceIds);
      const appointments = [];
      for (const workspace of workspaces) {
        const serviceIds = await loadServices(fetchFn, token, workspace);
        appointments.push(...await loadAppointments(
          fetchFn,
          token,
          workspace,
          serviceIds,
          startDate,
          endDate,
        ));
      }
      const result = dedupeAppointments(appointments);
      return response({
        ok: true,
        result,
        total: result.length,
        source: "teamdev-rdv",
        range: { start_date: startDate, end_date: endDate },
      });
    } catch (error) {
      if (error instanceof TeamdevUpstreamError) {
        return failure(error.code, "Service de rendez-vous Teamdev indisponible.", error.status);
      }
      return failure("TEAMDEV_CONNECTOR_FAILED", "Service de rendez-vous Teamdev indisponible.", 502);
    }
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createTeamdevRdvHandler());
}
