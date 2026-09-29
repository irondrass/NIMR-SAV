import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (file) => fs.readFileSync(file, "utf8");

function loadEdgeFactory() {
  let source = read("supabase/functions/teamdev-rdv/index.ts");
  source = source.replace(
    /^import\s+\{\s*createClient\s*\}\s+from\s+["'][^"']+["'];?\s*$/mu,
    "const createClient = (...args) => globalThis.__clientFactory(...args);"
  );
  source = source.replace(
    "export function createTeamdevRdvHandler",
    "function createTeamdevRdvHandler"
  );
  source = source.replace(
    /if \(typeof Deno !== ["']undefined["'][\s\S]*$/mu,
    ""
  );
  source += "\nglobalThis.__teamdevFactory = createTeamdevRdvHandler;";
  const context = {
    console,
    Request,
    Response,
    URL,
    URLSearchParams,
    AbortSignal,
    setTimeout,
    clearTimeout,
    __clientFactory: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function environment(values) {
  const map = new Map(Object.entries(values));
  return { get: (name) => map.get(name) };
}

function clientFactoryFor(role = "reception") {
  return () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from: () => {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        is() { return chain; },
        maybeSingle: async () => ({
          data: {
            workshop_id: "workshop-1",
            user_id: "user-1",
            role,
          },
          error: null,
        }),
      };
      return chain;
    },
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validEnv = () => environment({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  TEAMDEV_USERNAME: "server-user",
  TEAMDEV_PASSWORD: "server-pass",
  TEAMDEV_WORKSPACE_BINDINGS: JSON.stringify({
    "workshop-1": ["ws-dfsk", "ws-dongfeng"],
  }),
});

test("connector surface exists and browser contains no Teamdev credential or host literal", () => {
  assert.ok(fs.existsSync("supabase/functions/teamdev-rdv/index.ts"));
  const config = read("supabase/config.toml");
  const client = read("js/supabase-client.js");
  const rdv = read("js/rdv-integration.js");
  const reception = read("js/ui-reception.js");
  assert.match(config, /\[functions\.teamdev-rdv\][\s\S]*verify_jwt\s*=\s*true/u);
  assert.match(client, /function\s+invokeTeamdevRdv\s*\(/u);
  assert.doesNotMatch(client, /TEAMDEV_(?:USERNAME|PASSWORD)|bo\.nimr\.com\.tn/iu);
  assert.match(rdv, /refreshReceptionRdvSnapshots/u);
  assert.match(reception, /RECEPTION_RDV_REFRESH_TTL_MS\s*=\s*180000/u);
  assert.match(reception, /function\s+clearReceptionUpstreamAppointments\s*\(/u);
  assert.match(client, /signOut[\s\S]{0,1600}clearReceptionUpstreamAppointments/u);
});

test("edge rejects missing bearer before any Teamdev request", async () => {
  const edge = loadEdgeFactory();
  let fetchCount = 0;
  edge.__clientFactory = clientFactoryFor();
  const handler = edge.__teamdevFactory({
    environment: validEnv(),
    fetchFn: async () => { fetchCount += 1; throw new Error("unexpected"); },
  });
  const response = await handler(new Request("http://local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workshop_id: "workshop-1" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "UNAUTHENTICATED");
  assert.equal(fetchCount, 0);
});

test("edge refuses a workshop role outside Reception scope", async () => {
  const edge = loadEdgeFactory();
  let fetchCount = 0;
  edge.__clientFactory = clientFactoryFor("technicien");
  const handler = edge.__teamdevFactory({
    environment: validEnv(),
    fetchFn: async () => { fetchCount += 1; throw new Error("unexpected"); },
  });
  const response = await handler(new Request("http://local", {
    method: "POST",
    headers: {
      Authorization: "Bearer supabase-user-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workshop_id: "workshop-1" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN_RDV_READ");
  assert.equal(fetchCount, 0);
});

test("edge allows chef_atelier because the application grants Reception workspace access", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor("chef_atelier");
  let fetchCount = 0;
  const fetchFn = async (url) => {
    fetchCount += 1;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/backoffice/auth/signin")) {
      return jsonResponse({ access_token: "teamdev-token" });
    }
    if (parsed.pathname.endsWith("/backoffice/users/me")) {
      return jsonResponse({
        userWorkspaces: [
          { id: "ws-dfsk", brandId: "b1", agencyId: "a1", brandName: "DFSK" },
          { id: "ws-dongfeng", brandId: "b2", agencyId: "a1", brandName: "DONGFENG" },
        ],
      });
    }
    if (parsed.pathname.endsWith("/backoffice/services")) {
      return jsonResponse({ result: [] });
    }
    return jsonResponse({ error: "not-found" }, 404);
  };
  const handler = edge.__teamdevFactory({
    environment: validEnv(),
    fetchFn,
  });
  const response = await handler(new Request("http://local", {
    method: "POST",
    headers: {
      Authorization: "Bearer supabase-user-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workshop_id: "workshop-1" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.total, 0);
  assert.ok(fetchCount >= 4);
});

test("edge aggregates configured Teamdev workspaces using read-only upstream calls", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor();
  const calls = [];
  const upstreamAppointment = (id, interventionId, plate, km = 12000) => ({
    id,
    date: "2026-09-29T09:00:00.000Z",
    status: "CONFIRMED",
    updatedAt: "2026-09-29T07:00:00.000Z",
    secretField: "must-not-leak",
    intervention: {
      id: interventionId,
      status: "OPEN",
      description: "Vidange",
      km,
      requestedDate: "2026-09-29",
      service: { id: "svc", abstractService: { id: "abs", name: "Entretien" } },
      vehicle: {
        id: "veh",
        chassisNumber: "VIN12345678901234",
        registrationNumber: plate,
        version: { model: { title: "Shine" }, version: "Style" },
        client: {
          id: "client",
          firstName: "Ali",
          lastName: "Test",
          phones: [{ number: "22123456" }],
          mails: [{ address: "should-not-leak@example.com" }],
        },
      },
    },
  });
  const fetchFn = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || "GET";
    calls.push({ path: parsed.pathname, search: parsed.search, method });
    if (parsed.pathname.endsWith("/backoffice/auth/signin")) {
      return jsonResponse({ access_token: "teamdev-token", extra: "hidden" });
    }
    if (parsed.pathname.endsWith("/backoffice/users/me")) {
      return jsonResponse({
        userWorkspaces: [
          { id: "ws-dfsk", brandId: "b1", agencyId: "a1", brandName: "DFSK" },
          { id: "ws-dongfeng", brandId: "b2", agencyId: "a1", brandName: "DONGFENG" },
        ],
      });
    }
    if (parsed.pathname.endsWith("/backoffice/services")) {
      const brand = parsed.searchParams.get("brand");
      return jsonResponse({ result: [{ id: brand === "b1" ? "s1" : "s2", isAvailable: true }] });
    }
    if (parsed.pathname.endsWith("/backoffice/interventions/appointments")) {
      const brand = parsed.searchParams.get("brandName");
      return jsonResponse({
        result: [brand === "DFSK"
          ? upstreamAppointment("a-dfsk", "i-dfsk", "123TU1")
          : upstreamAppointment("a-df", "i-df", "456TU2", "")],
      });
    }
    return jsonResponse({ error: "not-found" }, 404);
  };
  const handler = edge.__teamdevFactory({
    environment: validEnv(),
    fetchFn,
    now: () => new Date("2026-09-29T08:00:00Z"),
  });
  const response = await handler(new Request("http://local", {
    method: "POST",
    headers: {
      Authorization: "Bearer supabase-user-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workshop_id: "workshop-1",
      start_date: "2026-09-29",
      end_date: "2026-09-29",
    }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result.length, 2);
  assert.deepEqual(body.result.map((item) => item.id).sort(), ["a-df", "a-dfsk"]);
  assert.equal(body.result.find((item) => item.id === "a-df").intervention.km, null);
  assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(body).includes("should-not-leak@example.com"), false);
  assert.equal(JSON.stringify(body).includes("teamdev-token"), false);
  assert.deepEqual(
    calls.filter((call) => !call.path.endsWith("/backoffice/auth/signin")).map((call) => call.method),
    ["GET", "GET", "GET", "GET", "GET"],
  );
  const appointmentCalls = calls.filter((call) =>
    call.path.endsWith("/backoffice/interventions/appointments")
  );
  assert.equal(appointmentCalls.length, 2);
  assert.ok(appointmentCalls.every((call) => call.search.includes("startDate=2026-09-29")));
  assert.ok(appointmentCalls.every((call) => call.search.includes("endDate=2026-09-29")));
  assert.ok(appointmentCalls.some((call) => call.search.includes("brandName=DFSK")));
  assert.ok(appointmentCalls.some((call) => call.search.includes("brandName=DONGFENG")));
});

test("combined DF-DFSK workspace works without a brandName filter", async () => {
  const edge = loadEdgeFactory();
  edge.__clientFactory = clientFactoryFor();
  const calls = [];
  const env = environment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    TEAMDEV_USERNAME: "server-user",
    TEAMDEV_PASSWORD: "server-pass",
    TEAMDEV_WORKSPACE_BINDINGS: JSON.stringify({ "workshop-1": ["ws-combined"] }),
  });
  const fetchFn = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, search: parsed.search, method: options.method || "GET" });
    if (parsed.pathname.endsWith("/backoffice/auth/signin")) return jsonResponse({ access_token: "teamdev-token" });
    if (parsed.pathname.endsWith("/backoffice/users/me")) return jsonResponse({
      userWorkspaces: [{ id: "ws-combined", brandId: "brand-combined", agencyId: "agency-charguia", brandName: null }],
    });
    if (parsed.pathname.endsWith("/backoffice/services")) return jsonResponse({ result: [{ id: "service-1", isAvailable: true }] });
    if (parsed.pathname.endsWith("/backoffice/interventions/appointments")) return jsonResponse({ result: [] });
    return jsonResponse({ error: "not-found" }, 404);
  };
  const handler = edge.__teamdevFactory({ environment: env, fetchFn });
  const response = await handler(new Request("http://local", {
    method: "POST",
    headers: { Authorization: "Bearer supabase-user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ workshop_id: "workshop-1", start_date: "2026-09-29", end_date: "2026-09-29" }),
  }));
  assert.equal(response.status, 200);
  const appointmentCall = calls.find((call) => call.path.endsWith("/backoffice/interventions/appointments"));
  assert.ok(appointmentCall);
  assert.equal(appointmentCall.search.includes("brandName="), false);
  assert.ok(appointmentCall.search.includes("services=service-1"));
});

test("browser transport invokes only the secured Edge Function", () => {
  const source = read("js/supabase-client.js");
  const start = source.indexOf("async function invokeTeamdevRdv");
  const end = source.indexOf("window.invokeTeamdevRdv", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /client\.functions\.invoke\(["']teamdev-rdv["']/u);
  assert.doesNotMatch(block, /fetch\s*\(|bo\.nimr\.com\.tn|TEAMDEV_(?:USERNAME|PASSWORD)/iu);
});
