import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/estimate-import.js",
  "js/ui-planning.js",
  "js/photos.js",
  "js/storage.js",
  "js/planning.js",
  "js/exports.js",
  "js/supabase-client.js",
  "app.js",
  "js/business-rules-v2187.js",
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by tests")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

function stubElement(tagName = "div") {
  const children = [];
  const classNames = new Set();
  const attributes = {};
  const listeners = {};
  const el = {
    tagName: tagName.toUpperCase(),
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    title: "",
    dataset: {},
    style: {},
    attributes,
    parentNode: null,
    nextSibling: null,
    children,
    elements: {},
    classList: {
      add: (...cls) => cls.forEach((c) => classNames.add(c)),
      remove: (...cls) => cls.forEach((c) => classNames.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classNames.has(c)) classNames.delete(c);
          else classNames.add(c);
        } else if (force) classNames.add(c);
        else classNames.delete(c);
      },
      contains: (c) => classNames.has(c),
    },
    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return attributes[k] ?? null; },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k) { return k in attributes; },
    remove() {
      if (el.parentNode && el.parentNode.children) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx >= 0) el.parentNode.children.splice(idx, 1);
      }
    },
    toggleAttribute(k, force) {
      if (force === undefined) {
        if (k in attributes) delete attributes[k];
        else attributes[k] = "";
      } else if (force) attributes[k] = "";
      else delete attributes[k];
    },
    addEventListener(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatch(evt, data) {
      (listeners[evt] || []).forEach((fn) => fn(data));
    },
    append(...els) {
      els.forEach(child => {
        child.parentNode = el;
        children.push(child);
      });
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    prepend(...els) {
      els.forEach(child => {
        child.parentNode = el;
        children.unshift(child);
      });
    },
    replaceChildren(...els) {
      children.length = 0;
      els.forEach(child => {
        child.parentNode = el;
        children.push(child);
      });
    },
    querySelector: (sel) => {
      if (sel === "[data-close]" || sel === "[data-open-full]" || sel === "[data-open-planning]") {
        const btn = stubElement("button");
        btn.dataset[sel.replace(/[[\]data-]/g, "")] = "true";
        return btn;
      }
      return stubElement();
    },
    querySelectorAll: () => [],
    closest: () => null,
    showModal() {},
    close() {},
  };
  return el;
}

const context = {
  console,
  stubElement,
  capturedDialogHtml: "",
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    getElementById: () => stubElement(),
    addEventListener() {},
    createElement: (tag) => stubElement(tag),
    body: stubElement("body"),
  },
  window: {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: "nimr-supabase-runtime-config",
    NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001",
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
  FormData: class {
    constructor(form) { this.data = new Map(); }
    get(k) { return this.data.get(k); }
    set(k, v) { this.data.set(k, v); }
  },
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

function setupScenario(role = "reception", customCase = {}) {
  app(`
    state = normalizeState({
      users: [
        { id: "u-admin", name: "Admin technique", role: "admin_technique", active: true },
        { id: "u-chef", name: "Chef atelier", role: "chef_atelier", active: true },
        { id: "u-directeur", name: "Directeur SAV", role: "directeur", active: true },
        { id: "u-rec-1", name: "Nourchen Gouiaa", role: "reception", active: true },
        { id: "u-rec-2", email: "mohamed.reception@example.com", role: "reception", active: true },
        { id: "u-tech-1", name: "Technicien DF", role: "technicien", resourceId: "res-tech-1", active: true },
        { id: "u-readonly", name: "Lecture seule", role: "lecture_seule", active: true }
      ],
      currentUserId: "${role.startsWith("u-") ? role : "u-" + role}",
      resources: [
        { id: "res-tech-1", name: "Nabil M.", role: "mecanicien", active: true },
        { id: "res-tech-2", name: "Karim T.", role: "tolier", active: true }
      ],
      cases: [Object.assign({
        id: "case-r2-01",
        clientName: "Société Maghreb Transport",
        vehicle: "DongFeng Rich 6",
        plate: "220 TU 8899",
        vin: "LDF12345678901234",
        phone: "+216 20 123 456",
        flags: {
          expertApproved: true,
          clientApproved: true,
          received: true,
          workStarted: false,
          workCompleted: false,
          invoiced: false,
          delivered: false
        },
        clientCommitment: {
          promisedAt: "2026-09-21T16:00:00.000Z",
          nextContactAt: "2026-09-19T09:00:00.000Z",
          note: "Client prévenu pour validation devis"
        },
        appointment: {
          start: "2026-09-20T08:00:00.000Z",
          delivery: "2026-09-21T17:00:00.000Z",
          end: "2026-09-20T12:00:00.000Z"
        },
        durations: { mechanical: 2, body: 3 },
        claims: [{
          id: "claim-01",
          type: "client",
          number: "OR-2026-DF01",
          includeInPlanning: true,
          clientApproved: true,
          expertApproved: true,
          estimate: {
            lines: [
              { phase: "mechanical", operation: "Révision mécanique", laborHours: 2 }
            ]
          }
        }],
        history: [],
        notes: { reception: "Véhicule propre", technique: "", qualite: "", direction: "" },
        receptionWorkflow: {
          rdvConfirmedAt: "2026-09-18T10:00:00.000Z",
          vehicleReceivedAt: "2026-09-20T08:00:00.000Z"
        }
      }, ${JSON.stringify(customCase)})],
      bookings: [
        {
          id: "b-r2-01",
          caseId: "case-r2-01",
          resourceIds: ["res-tech-1"],
          key: "mechanical",
          title: "Révision mécanique",
          status: "planned",
          start: "2026-09-20T08:00:00.000Z",
          end: "2026-09-20T10:00:00.000Z",
          segments: [{ start: "2026-09-20T08:00:00.000Z", end: "2026-09-20T10:00:00.000Z" }]
        }
      ],
      auditLog: []
    });
  `);
}

function openModalAndCapture() {
  return app(`
    (() => {
      capturedDialogHtml = "";
      document.createElement = function(tag) {
        const el = stubElement(tag);
        if (tag === "dialog") {
          Object.defineProperty(el, "innerHTML", {
            set(val) { capturedDialogHtml = val; this._html = val; },
            get() { return this._html || ""; }
          });
        }
        return el;
      };
      openOperationalCasePanel("case-r2-01");
      return capturedDialogHtml;
    })()
  `);
}

test("TEST R2-01: Today card shows customer phone when available", () => {
  setupScenario("u-rec-1");
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.match(html, /\+216 20 123 456/, "Today card should display customer phone text");
  assert.match(html, /tel:\+21620123456/, "Today card should have a clickable tel: link");
});

test("TEST R2-02: Phone link uses sanitized tel: href", () => {
  setupScenario("u-rec-1", { phone: "+216 (20) 123-456" });
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.match(html, /href="tel:\+21620123456"/, "Sanitized tel href must preserve leading + and strip spaces/parens/hyphens");
});

test("TEST R2-03: Malicious/non-phone values cannot create arbitrary executable href", () => {
  setupScenario("u-rec-1", { phone: "javascript:alert(document.cookie)" });
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.doesNotMatch(html, /href="javascript:/, "Dangerous javascript scheme must never be generated");
  assert.doesNotMatch(html, /href="https?:/, "HTTP/HTTPS schemes must never be accepted as phone href");
});

test("TEST R2-04: Missing phone renders neutral text and no tel: href", () => {
  setupScenario("u-rec-1", { phone: "" });
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.match(html, /Téléphone non renseigné/, "Neutral message must be displayed when phone is missing");
  assert.doesNotMatch(html, /href="tel:/, "No tel link should be rendered when phone is empty");
});

test("TEST R2-05: Quick modal exposes phone in first-level customer section", () => {
  setupScenario("u-rec-1");
  const dialogHtml = openModalAndCapture();
  assert.match(dialogHtml, /tel:\+21620123456/, "Quick modal must expose customer phone as tel: link in Section 1");
  assert.match(dialogHtml, /\+216 20 123 456/, "Quick modal must display customer phone");
});

test("TEST R2-06: Responsible selector displays user name + French role label", () => {
  setupScenario("u-rec-1");
  const dialogHtml = openModalAndCapture();
  assert.match(dialogHtml, /Nourchen Gouiaa — Réception/, "Option label must display user name followed by role label");
});

test("TEST R2-07: Responsible selector keeps canonical underlying option value unchanged", () => {
  setupScenario("u-rec-1");
  const dialogHtml = openModalAndCapture();
  assert.match(dialogHtml, /value="u-rec-1"/, "Option value must keep the canonical user ID");
  assert.match(dialogHtml, /value="u-chef"/, "Option value must keep the canonical user ID");
});

test("TEST R2-08: Email is used only as fallback if user has no usable display name", () => {
  setupScenario("u-rec-1");
  const dialogHtml = openModalAndCapture();
  assert.match(dialogHtml, /mohamed\.reception@example\.com — Réception/, "User without explicit name must fall back to email + role label");
});

test("TEST R2-09: Complaint responsible selector uses same safe label behavior", () => {
  setupScenario("u-rec-1");
  const html = app(`
    (() => {
      const target = stubElement("div");
      renderCustomerRequests(target, state.cases[0]);
      return target.innerHTML;
    })()
  `);
  assert.match(html, /Nourchen Gouiaa — Réception/, "Complaint responsible selector must display Name — Role label");
});

test("TEST R2-10: Promise and ETA remain separately labeled and do not overwrite each other", () => {
  setupScenario("u-rec-1");
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.match(html, /Promesse/i, "Promesse must be labeled distinctly");
  assert.match(html, /Disponibilité/i, "Disponibilité estimée must be labeled distinctly");
});

test("TEST R2-11: Quick-modal reordering does not remove existing agreement/follow-up, parts, complaints, or dossier-full controls", () => {
  setupScenario("u-rec-1");
  const dialogHtml = openModalAndCapture();
  assert.match(dialogHtml, /data-client-followup/, "Follow-up form must be present");
  assert.match(dialogHtml, /data-field="case-blocker-controls"/, "Parts/blocker controls must be present");
  assert.match(dialogHtml, /data-customer-requests/, "Customer requests placeholder must be present");
  assert.match(dialogHtml, /data-open-full/, "Full dossier button must be present");
});

test("TEST R2-12: Customer-follow-up draft survives relevant rerender", () => {
  setupScenario("u-rec-1");
  openModalAndCapture();
  // Simulate user editing follow-up input
  app(`
    if (typeof captureClientFollowupDraft === "function") {
      captureClientFollowupDraft("case-r2-01", {
        promisedAt: "2026-09-22T14:00",
        nextContactAt: "2026-09-20T11:00",
        note: "Brouillon non sauvegardé",
        contacted: true
      });
    }
  `);
  const rerenderedHtml = openModalAndCapture();
  assert.match(rerenderedHtml, /Brouillon non sauvegardé/, "Unsaved follow-up note must survive modal rerender");
  assert.match(rerenderedHtml, /2026-09-22T14:00/, "Unsaved promise date must survive modal rerender");
});

test("TEST R2-13: Aujourd'hui card still uses existing next-action result without changing business priority", () => {
  setupScenario("u-rec-1");
  const html = app(`
    (() => {
      const row = buildWorkshopProgressRow(state.cases[0], new Date("2026-09-19T08:00:00Z"));
      return renderWorkshopProgressRow(row);
    })()
  `);
  assert.ok(html.includes("Consulter") || html.includes("action"), "Should retain canonical next-action presentation");
});

test("TEST R2-14: R1 unauthorized workshop actions remain absent for Reception", () => {
  setupScenario("u-rec-1");
  const bookingHtml = app(`renderBookingTaskActions(state.bookings[0])`);
  assert.equal(bookingHtml.includes('data-booking-action="start"'), false, "Démarrer must be absent for reception");
  assert.equal(bookingHtml.includes('data-booking-action="reschedule"'), false, "Replanifier must be absent for reception");
});

test("TEST R2-15: Authorized workshop roles retain their controls", () => {
  setupScenario("u-chef");
  const bookingHtml = app(`renderBookingTaskActions(state.bookings[0])`);
  assert.ok(bookingHtml.includes('data-booking-action="start"'), "Chef atelier retains Démarrer action");
});

test("TEST R2-16: Received/incomplete-identity R1 rendering remains unchanged", () => {
  setupScenario("u-rec-1", { plate: "", vin: "" });
  const identityHtml = app(`
    (() => {
      const root = stubElement("div");
      root.querySelector = function(sel) {
        if (sel === ".reception-intro p") return stubElement("p");
        if (sel === "[data-field='vehicle-identity']") return this;
        return stubElement("div");
      };
      renderVehicleIdentityCard(root, state.cases[0]);
      return root.innerHTML;
    })()
  `);
  assert.match(identityHtml, /Données véhicule à compléter/, "Incomplete vehicle identity must display alert badge");
  assert.match(identityHtml, /Réception confirmée/, "Confirmed reception badge must remain displayed");
});
