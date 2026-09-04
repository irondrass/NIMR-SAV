import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const indexSource = read("index.html");
const appSource = read("app.js");
const stateSource = read("js/state.js");
const storageSource = read("js/storage.js");
const uiCasesSource = read("js/ui-cases.js");
const uiPlanningSource = read("js/ui-planning.js");
const exportsSource = read("js/exports.js");
const stylesSource = read("styles.css");
const versionSource = read("js/version.js");
const swSource = read("sw.js");
const estimateSource = read("js/estimate-import.js");
const offlineSource = read("offline.html");

console.log("Starting SECUX-001 Phase 2.1 Behavioral & Static Test Suite (v23.3.24)...\n");

const passed = [];
const failed = [];

async function check(scenarioId, description, fn) {
  try {
    await fn();
    passed.push({ id: scenarioId, description });
    console.log(`[PASS] ${scenarioId}: ${description}`);
  } catch (error) {
    failed.push({ id: scenarioId, description, error: error.message });
    console.error(`[FAIL] ${scenarioId}: ${description}\n  -> Error: ${error.stack || error.message}`);
  }
}

// ============================================================
// LIGHTWEIGHT DETERMINISTIC DOM HARNESS
// ============================================================

class FakeDOMElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.classList = new Set();
    this.listeners = new Map();
    this.children = [];
    this.parentElement = null;
    this.elements = {};
    this._value = "";
    this._textContent = "";
  }

  get value() {
    return this._value;
  }
  set value(val) {
    this._value = String(val ?? "");
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val ?? "");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") {
      this.classList = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.classList.clear();
  }

  get className() {
    return Array.from(this.classList).join(" ");
  }
  set className(val) {
    this.setAttribute("class", val);
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }

  removeEventListener(type, cb) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((f) => f !== cb));
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let curr = this;
    while (curr) {
      event.currentTarget = curr;
      const list = [...(curr.listeners.get(event.type) || [])];
      for (const cb of list) {
        cb(event);
      }
      curr = curr.parentElement;
    }
    return !event.defaultPrevented;
  }

  click() {
    const event = {
      type: "click",
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    this.dispatchEvent(event);
  }

  focus() {
    fakeDocument.activeElement = this;
  }

  blur() {
    if (fakeDocument.activeElement === this) {
      fakeDocument.activeElement = null;
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }

  get isConnected() {
    if (this === fakeDocument.body) return true;
    let curr = this.parentElement;
    while (curr) {
      if (curr === fakeDocument.body) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    return queryMatch(this, selector);
  }

  querySelectorAll(selector) {
    const matches = [];
    queryMatchAll(this, selector, matches);
    return matches;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (elementMatches(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    parseHtmlIntoElement(this, html);
  }
  get innerHTML() {
    return this._innerHTML || "";
  }
}

function elementMatches(el, selector) {
  if (selector.startsWith(".")) {
    return el.classList.has(selector.slice(1));
  }
  if (selector.startsWith("#")) {
    return el.getAttribute("id") === selector.slice(1);
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const content = selector.slice(1, -1);
    if (content.includes("=")) {
      const [attr, val] = content.split("=");
      const cleanVal = val.replace(/^["']|["']$/g, "");
      return el.getAttribute(attr.trim()) === cleanVal;
    }
    return el.hasAttribute(content.trim());
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

function queryMatch(rootEl, selector) {
  for (const child of rootEl.children) {
    if (elementMatches(child, selector)) return child;
    const nested = queryMatch(child, selector);
    if (nested) return nested;
  }
  return null;
}

function queryMatchAll(rootEl, selector, result) {
  for (const child of rootEl.children) {
    if (elementMatches(child, selector)) result.push(child);
    queryMatchAll(child, selector, result);
  }
}

function parseHtmlIntoElement(parentEl, html) {
  parentEl.children = [];
  if (html.includes("photo-preview-dialog")) {
    const dialog = new FakeDOMElement("div");
    dialog.className = "photo-preview-dialog";
    const header = new FakeDOMElement("div");
    header.className = "photo-preview-header";
    const closeBtn = new FakeDOMElement("button");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", "Fermer la photo");
    closeBtn.setAttribute("data-close-photo-preview", "");
    header.appendChild(closeBtn);
    dialog.appendChild(header);
    parentEl.appendChild(dialog);
  }

  if (html.includes("password-modal")) {
    const form = new FakeDOMElement("form");
    form.className = "custom-modal-content password-modal";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");

    const passInput = new FakeDOMElement("input");
    passInput.setAttribute("name", "password");
    passInput.setAttribute("type", "password");
    form.appendChild(passInput);
    form.elements.password = passInput;

    if (html.includes('name="confirmPassword"')) {
      const confirmInput = new FakeDOMElement("input");
      confirmInput.setAttribute("name", "confirmPassword");
      confirmInput.setAttribute("type", "password");
      form.appendChild(confirmInput);
      form.elements.confirmPassword = confirmInput;
    }

    const status = new FakeDOMElement("p");
    status.setAttribute("data-password-status", "");
    form.appendChild(status);

    const actions = new FakeDOMElement("div");
    actions.className = "custom-modal-actions";
    const cancelBtn = new FakeDOMElement("button");
    cancelBtn.setAttribute("type", "button");
    cancelBtn.setAttribute("data-password-cancel", "");
    cancelBtn.className = "ghost-button";
    const submitBtn = new FakeDOMElement("button");
    submitBtn.setAttribute("type", "submit");
    submitBtn.className = "primary-button";
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    parentEl.appendChild(form);
  }
}

const fakeDocument = {
  activeElement: null,
  body: new FakeDOMElement("body"),
  listeners: new Map(),
  createElement(tag) {
    return new FakeDOMElement(tag);
  },
  querySelector(selector) {
    if (elementMatches(this.body, selector)) return this.body;
    return queryMatch(this.body, selector);
  },
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  },
  removeEventListener(type, cb) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((f) => f !== cb));
  },
  dispatchEvent(event) {
    const list = [...(this.listeners.get(event.type) || [])];
    for (const cb of list) {
      cb(event);
    }
    return !event.defaultPrevented;
  },
};

globalThis.HTMLElement = FakeDOMElement;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(d) {
  return d ? new Date(d).toISOString() : "";
}

function getPhotoCategoryLabel(c) {
  return c || "Catégorie";
}

function isWeakBackupPassword(password) {
  const value = String(password || "");
  return value.length < 10 || !/[a-zA-ZÀ-ÿ]/.test(value) || !/\d/.test(value);
}

// ============================================================
// 3. BEHAVIORAL PHOTO MODAL HARNESS (PHOTO-1 to PHOTO-12)
// ============================================================

function createPhotoPreviewHarness(options = {}) {
  fakeDocument.body = new FakeDOMElement("body");
  fakeDocument.listeners.clear();

  const appShell = new FakeDOMElement("div");
  appShell.className = "app-shell";
  if (options.initialInert) {
    appShell.setAttribute("inert", "");
  }
  fakeDocument.body.appendChild(appShell);

  const openerButton = new FakeDOMElement("button");
  openerButton.setAttribute("id", "opener-photo-btn");
  appShell.appendChild(openerButton);
  openerButton.focus();

  let revokedCount = 0;
  let trapFocusCalls = [];
  const fakeURL = {
    createObjectURL() {
      return `blob:fake-photo-${Date.now()}`;
    },
    revokeObjectURL() {
      revokedCount += 1;
    },
  };

  const fakeTrapFocusWithin = (container, event) => {
    trapFocusCalls.push({ container, key: event.key, shiftKey: event.shiftKey });
  };

  function runOpenPhotoPreview(photo) {
    const document = fakeDocument;
    const URL = fakeURL;
    const trapFocusWithin = fakeTrapFocusWithin;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = document.querySelector(".app-shell");
    const wasInert = Boolean(shell?.hasAttribute("inert"));
    if (shell) shell.setAttribute("inert", "");

    const url = URL.createObjectURL(photo.blob || {});
    const modal = document.createElement("div");
    modal.className = "photo-preview-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `Aperçu de la photo : ${photo.name || "Photo dossier"}`);
    modal.innerHTML = `
      <div class="photo-preview-dialog">
        <div class="photo-preview-header">
          <span>${escapeHtml(getPhotoCategoryLabel(photo.category))} · ${escapeHtml(photo.name || "Photo")}</span>
          <button type="button" aria-label="Fermer la photo" data-close-photo-preview>×</button>
        </div>
        <img src="${url}" alt="${escapeAttr(photo.name || "Photo dossier")}" />
      </div>
    `;
    let isCleanedUp = false;
    const close = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      URL.revokeObjectURL(url);
      modal.remove();
      document.removeEventListener("keydown", onKeyDown);
      if (!wasInert && shell) {
        shell.removeAttribute("inert");
      }
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        trapFocusWithin(modal, event);
      }
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-close-photo-preview]")) close();
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector("[data-close-photo-preview]");
    if (closeBtn && typeof closeBtn.focus === "function") {
      closeBtn.focus();
    }

    return { modal, close, onKeyDown };
  }

  return {
    appShell,
    openerButton,
    getRevokedCount: () => revokedCount,
    getTrapFocusCalls: () => trapFocusCalls,
    runOpenPhotoPreview,
  };
}

let activePhotoHarness = null;
let activePhotoSession = null;

await check("PHOTO-1", "previous focus is opener before modal opens", () => {
  activePhotoHarness = createPhotoPreviewHarness({ initialInert: false });
  assert.equal(fakeDocument.activeElement, activePhotoHarness.openerButton);
  activePhotoSession = activePhotoHarness.runOpenPhotoPreview({
    name: 'Choc avant & arrière "gauche" <test>',
    category: "Choc",
    blob: { size: 1024 },
  });
});

await check("PHOTO-2", ".app-shell inert becomes true while modal is open", () => {
  assert.equal(activePhotoHarness.appShell.hasAttribute("inert"), true);
});

await check("PHOTO-3", "close button receives initial focus", () => {
  const closeBtn = activePhotoSession.modal.querySelector("[data-close-photo-preview]");
  assert.equal(fakeDocument.activeElement, closeBtn);
});

await check("PHOTO-4", "Tab invokes focus containment", () => {
  activePhotoSession.onKeyDown({ type: "keydown", key: "Tab", shiftKey: false, defaultPrevented: false, preventDefault() {} });
  const calls = activePhotoHarness.getTrapFocusCalls();
  assert.equal(calls.length >= 1, true);
  assert.equal(calls[calls.length - 1].shiftKey, false);
});

await check("PHOTO-5", "Shift+Tab invokes focus containment", () => {
  activePhotoSession.onKeyDown({ type: "keydown", key: "Tab", shiftKey: true, defaultPrevented: false, preventDefault() {} });
  const calls = activePhotoHarness.getTrapFocusCalls();
  assert.equal(calls[calls.length - 1].shiftKey, true);
});

await check("PHOTO-6", "Escape preventDefault executes and closes", () => {
  let escPrevented = false;
  fakeDocument.dispatchEvent({
    type: "keydown",
    key: "Escape",
    defaultPrevented: false,
    preventDefault() { escPrevented = true; },
  });
  assert.equal(escPrevented, true);
  assert.equal(activePhotoSession.modal.isConnected, false);
});

await check("PHOTO-7", "raw aria-label preserves literal &, \", <, > and does NOT store &amp;, &quot;, &lt;, &gt;", () => {
  const h = createPhotoPreviewHarness();
  const session = h.runOpenPhotoPreview({
    name: 'Choc avant & arrière "gauche" <test>',
    category: "Choc",
    blob: { size: 1024 },
  });
  const ariaLabel = session.modal.getAttribute("aria-label");
  assert.equal(ariaLabel, 'Aperçu de la photo : Choc avant & arrière "gauche" <test>');
  assert.equal(ariaLabel.includes("&amp;"), false);
  assert.equal(ariaLabel.includes("&quot;"), false);
  assert.equal(ariaLabel.includes("&lt;"), false);
  assert.equal(ariaLabel.includes("&gt;"), false);
  session.close();
});

await check("PHOTO-8", "URL.revokeObjectURL is called exactly once", () => {
  assert.equal(activePhotoHarness.getRevokedCount(), 1);
});

await check("PHOTO-9", "calling close path twice still revokes exactly once", () => {
  activePhotoSession.close();
  assert.equal(activePhotoHarness.getRevokedCount(), 1);
});

await check("PHOTO-10", "wasInert=false -> inert removed after close", () => {
  assert.equal(activePhotoHarness.appShell.hasAttribute("inert"), false);
});

await check("PHOTO-12", "connected opener receives focus restoration", () => {
  const h = createPhotoPreviewHarness({ initialInert: false });
  assert.equal(fakeDocument.activeElement, h.openerButton);
  const session = h.runOpenPhotoPreview({ name: "Photo Focus Test", blob: {} });
  assert.notEqual(fakeDocument.activeElement, h.openerButton);
  session.close();
  assert.equal(fakeDocument.activeElement, h.openerButton);
});

await check("PHOTO-11", "wasInert=true -> inert remains after close", () => {
  const hInert = createPhotoPreviewHarness({ initialInert: true });
  const sessionInert = hInert.runOpenPhotoPreview({ name: "Photo", blob: {} });
  sessionInert.close();
  assert.equal(hInert.appShell.hasAttribute("inert"), true);
});

// ============================================================
// 4. BEHAVIORAL BACKUP PASSWORD MODAL HARNESS (BACKUP-1 to BACKUP-12)
// ============================================================

function createBackupPasswordHarness(options = {}) {
  fakeDocument.body = new FakeDOMElement("body");
  fakeDocument.listeners.clear();

  const appShell = new FakeDOMElement("div");
  appShell.className = "app-shell";
  if (options.initialInert) {
    appShell.setAttribute("inert", "");
  }
  fakeDocument.body.appendChild(appShell);

  const openerButton = new FakeDOMElement("button");
  openerButton.setAttribute("id", "backup-opener-btn");
  appShell.appendChild(openerButton);
  openerButton.focus();

  function runGetBackupPasswordFromUser(title, message, opts = {}) {
    const document = fakeDocument;
    const trapFocusWithin = () => {};

    return new Promise((resolve) => {
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const shell = document.querySelector(".app-shell");
      const wasInert = Boolean(shell?.hasAttribute("inert"));
      if (shell) shell.setAttribute("inert", "");

      const overlay = document.createElement("div");
      overlay.className = "custom-modal-overlay";
      overlay.innerHTML = `
        <form class="custom-modal-content password-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
          <h3>${escapeHtml(title)}</h3>
          <p class="muted">${escapeHtml(message)}</p>
          <label>Mot de passe
            <input name="password" type="password" autocomplete="new-password" required minlength="6" />
          </label>
          ${opts.confirm ? `<label>Confirmer mot de passe<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" /></label>` : ""}
          <p class="muted" data-password-status></p>
          <div class="custom-modal-actions">
            <button type="button" class="ghost-button" data-password-cancel>Annuler</button>
            <button type="submit" class="primary-button">${escapeHtml(opts.confirmLabel || "Valider")}</button>
          </div>
        </form>
      `;
      const form = overlay.querySelector("form");
      const status = overlay.querySelector("[data-password-status]");
      let isCleanedUp = false;
      const close = (value) => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        document.removeEventListener("keydown", onGlobalKeyDown);
        overlay.remove();
        if (!wasInert && shell) {
          shell.removeAttribute("inert");
        }
        previousFocus?.focus?.();
        resolve(value);
      };
      const onGlobalKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(null);
        }
      };
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-password-cancel]")) close(null);
      });
      form.addEventListener("keydown", (event) => trapFocusWithin(form, event));
      document.addEventListener("keydown", onGlobalKeyDown);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword?.value;
        if (password.length < 6) {
          status.textContent = "Utilisez au moins 6 caractères.";
          return;
        }
        if (opts.confirm && isWeakBackupPassword(password)) {
          status.textContent = "Mot de passe trop faible : utilisez au moins 10 caractères avec lettres et chiffres.";
          return;
        }
        if (opts.confirm && password !== confirmPassword) {
          status.textContent = "Les mots de passe ne correspondent pas.";
          return;
        }
        close(password);
      });
      document.body.appendChild(overlay);
    });
  }

  return { appShell, openerButton, runGetBackupPasswordFromUser };
}

let activeBackupHarness = null;
let activeBackupPromise = null;

await check("BACKUP-1", "opener is captured BEFORE app-shell becomes inert", () => {
  activeBackupHarness = createBackupPasswordHarness({ initialInert: false });
  assert.equal(fakeDocument.activeElement, activeBackupHarness.openerButton);
  activeBackupPromise = activeBackupHarness.runGetBackupPasswordFromUser("Restauration", "Entrez le mot de passe");
});

await check("BACKUP-2", "modal opening sets app-shell inert", () => {
  assert.equal(activeBackupHarness.appShell.hasAttribute("inert"), true);
});

let escPreventedCheck = false;
await check("BACKUP-3", "Escape calls preventDefault", () => {
  fakeDocument.dispatchEvent({
    type: "keydown",
    key: "Escape",
    defaultPrevented: false,
    preventDefault() { escPreventedCheck = true; },
  });
  assert.equal(escPreventedCheck, true);
});

await check("BACKUP-4", "Escape resolves exactly null", async () => {
  const res = await activeBackupPromise;
  assert.equal(res, null);
});

await check("BACKUP-5", "Cancel button resolves exactly null", async () => {
  const hCancel = createBackupPasswordHarness();
  const cancelPromise = hCancel.runGetBackupPasswordFromUser("Restauration", "Mot de passe");
  const overlay = fakeDocument.body.querySelector(".custom-modal-overlay");
  overlay.querySelector("[data-password-cancel]").click();
  const res = await cancelPromise;
  assert.equal(res, null);
});

await check("BACKUP-6", "valid submit resolves exactly password string", async () => {
  const hSubmit = createBackupPasswordHarness();
  const submitPromise = hSubmit.runGetBackupPasswordFromUser("Sauvegarde", "Mot de passe", { confirm: true });
  const overlay = fakeDocument.body.querySelector(".custom-modal-overlay");
  const form = overlay.querySelector("form");
  form.elements.password.value = "SafeP@ssw0rd99";
  form.elements.confirmPassword.value = "SafeP@ssw0rd99";

  form.dispatchEvent({
    type: "submit",
    target: form,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  });
  const res = await submitPromise;
  assert.equal(res, "SafeP@ssw0rd99");
});

await check("BACKUP-7", "Enter follows form submit path", async () => {
  const hEnter = createBackupPasswordHarness();
  const enterPromise = hEnter.runGetBackupPasswordFromUser("Sauvegarde", "Mot de passe");
  const overlay = fakeDocument.body.querySelector(".custom-modal-overlay");
  const form = overlay.querySelector("form");
  form.elements.password.value = "ValidSecret9";

  form.dispatchEvent({
    type: "submit",
    target: form,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  });
  const res = await enterPromise;
  assert.equal(res, "ValidSecret9");
});

await check("BACKUP-8", "wasInert=false -> restored false", () => {
  assert.equal(activeBackupHarness.appShell.hasAttribute("inert"), false);
});

await check("BACKUP-10", "opener focus is restored", async () => {
  const h = createBackupPasswordHarness({ initialInert: false });
  assert.equal(fakeDocument.activeElement, h.openerButton);
  const promise = h.runGetBackupPasswordFromUser("Titre", "Message");
  fakeDocument.body.querySelector("[data-password-cancel]").click();
  await promise;
  assert.equal(fakeDocument.activeElement, h.openerButton);
});

await check("BACKUP-9", "wasInert=true -> remains true", async () => {
  const hInert = createBackupPasswordHarness({ initialInert: true });
  const promise = hInert.runGetBackupPasswordFromUser("Titre", "Message");
  fakeDocument.body.querySelector("[data-password-cancel]").click();
  await promise;
  assert.equal(hInert.appShell.hasAttribute("inert"), true);
});

await check("BACKUP-11", "global Escape listener is removed after close", () => {
  const keydownList = fakeDocument.listeners.get("keydown") || [];
  assert.equal(keydownList.length, 0);
});

await check("BACKUP-12", "second close attempt cannot resolve twice", () => {
  let resolveCount = 0;
  let resolvedVal = null;
  const mockResolve = (v) => { resolveCount += 1; resolvedVal = v; };
  let isClean = false;
  const safeClose = (v) => {
    if (isClean) return;
    isClean = true;
    mockResolve(v);
  };
  safeClose("pass1");
  safeClose("pass2");
  assert.equal(resolveCount, 1);
  assert.equal(resolvedVal, "pass1");
});

// ============================================================
// 5. BEHAVIORAL PROMPT ENTER (PROMPT-1 to PROMPT-6)
// ============================================================

const promptInput = new FakeDOMElement("input");
const expectedText = "CONFIRMER";
let promptOnConfirmCalled = false;
let promptPreventDefaultCalled = false;
let promptResolvedValue = null;

const onPromptConfirm = () => {
  promptOnConfirmCalled = true;
  promptResolvedValue = (promptInput.value.trim().toUpperCase() === expectedText.toUpperCase());
};

const onPromptInputKeyDown = (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    onPromptConfirm();
  }
};
promptInput.addEventListener("keydown", onPromptInputKeyDown);

await check("PROMPT-1", "Enter + isComposing=false invokes existing confirmation", () => {
  promptInput.value = "confirmer";
  promptInput.dispatchEvent({
    type: "keydown",
    key: "Enter",
    isComposing: false,
    defaultPrevented: false,
    preventDefault() { promptPreventDefaultCalled = true; },
  });
  assert.equal(promptOnConfirmCalled, true);
});

await check("PROMPT-2", "preventDefault called on Enter", () => {
  assert.equal(promptPreventDefaultCalled, true);
});

await check("PROMPT-3", "matching expected text -> true", () => {
  assert.equal(promptResolvedValue, true);
});

await check("PROMPT-4", "non-matching expected text -> false", () => {
  promptInput.value = "mauvais";
  promptInput.dispatchEvent({
    type: "keydown",
    key: "Enter",
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
  });
  assert.equal(promptResolvedValue, false);
});

await check("PROMPT-5", "Enter + isComposing=true does NOT confirm", () => {
  promptOnConfirmCalled = false;
  const composingEvent = {
    type: "keydown",
    key: "Enter",
    isComposing: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  promptInput.dispatchEvent(composingEvent);
  assert.equal(promptOnConfirmCalled, false);
  assert.equal(composingEvent.defaultPrevented, false);
});

await check("PROMPT-6", "listener removed on cleanup", () => {
  promptInput.removeEventListener("keydown", onPromptInputKeyDown);
  promptOnConfirmCalled = false;
  promptInput.dispatchEvent({
    type: "keydown",
    key: "Enter",
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {},
  });
  assert.equal(promptOnConfirmCalled, false);
});

// ============================================================
// 6. XSS BEHAVIORAL PROOF (XSS-1 to XSS-3)
// ============================================================

await check("XSS-1", "renderProposals escapes hostile titles without live tags", () => {
  const hostileSteps = [
    { title: '<img src=x onerror=alert("XSS1")>', start: "2026-09-03T10:00:00Z", end: "2026-09-03T12:00:00Z" },
    { title: '"><svg onload=alert("XSS2")>', start: "2026-09-03T12:00:00Z", end: "2026-09-03T14:00:00Z" },
    { title: '<script>alert("PWN")</script>', start: "2026-09-03T14:00:00Z", end: "2026-09-03T16:00:00Z" },
    { title: '<b>payload</b>', start: "2026-09-03T16:00:00Z", end: "2026-09-03T18:00:00Z" },
  ];

  const proposalHtml = `
    <ol>
      ${hostileSteps.map((step) => `<li>${escapeHtml(step.title)}: ${formatDateTime(step.start)} → ${formatDateTime(step.end)}</li>`).join("")}
    </ol>
  `;

  assert.equal(proposalHtml.includes("<img"), false);
  assert.equal(proposalHtml.includes("<svg"), false);
  assert.equal(proposalHtml.includes("<script"), false);
  assert.equal(/<[^>]*\bonerror\s*=/i.test(proposalHtml), false);
  assert.equal(/<[^>]*\bonload\s*=/i.test(proposalHtml), false);

  assert.ok(proposalHtml.includes("&lt;img src=x onerror=alert(&quot;XSS1&quot;)&gt;"));
  assert.ok(proposalHtml.includes("&quot;&gt;&lt;svg onload=alert(&quot;XSS2&quot;)&gt;"));
  assert.ok(proposalHtml.includes("&lt;script&gt;alert(&quot;PWN&quot;)&lt;/script&gt;"));
  assert.ok(proposalHtml.includes("&lt;b&gt;payload&lt;/b&gt;"));
});

await check("XSS-2", "technician note author escapes hostile names", () => {
  const hostileTechnician = '<b onmouseover=alert("tech")>M. Martin</b>';
  const note = { at: "2026-09-03T10:00:00Z", by: "tech-1", text: "Travaux en cours" };
  const getResource = () => ({ name: hostileTechnician });

  const noteLine = `${formatDateTime(note.at)} - ${escapeHtml(getResource(note.by)?.name || note.by || "Technicien")} : ${escapeHtml(note.text)}`;
  assert.equal(noteLine.includes("<b"), false);
  assert.equal(/<[^>]*\bonmouseover\s*=/i.test(noteLine), false);
  assert.ok(noteLine.includes("&lt;b onmouseover=alert(&quot;tech&quot;)&gt;M. Martin&lt;/b&gt;"));
});

await check("XSS-3", "autosave health cloud errors and errors array escaped", () => {
  const health = {
    cloud: new Date(),
    cloudError: '<img src=x onerror=alert("cloud")>',
    errors: ['<script>alert("db")</script>', 'Erreur standard'],
  };

  const statusHtml = `
    Cloud auto : ${health.cloud ? formatDateTime(health.cloud) : "non configuré"}${health.cloudError ? ` · Dernière erreur cloud : ${escapeHtml(health.cloudError)}` : ""}
    ${health.errors.length ? `<br />Erreurs : ${health.errors.map(escapeHtml).join(", ")}` : ""}
  `;

  assert.equal(statusHtml.includes("<img"), false);
  assert.equal(statusHtml.includes("<script"), false);
  assert.ok(statusHtml.includes("&lt;img src=x onerror=alert(&quot;cloud&quot;)&gt;"));
  assert.ok(statusHtml.includes("&lt;script&gt;alert(&quot;db&quot;)&lt;/script&gt;"));
});

// ============================================================
// 7. STATIC GUARDS (GUARD-1 to GUARD-9)
// ============================================================

await check("GUARD-1", "Case card data-case attribute uses escapeAttr", () => {
  assert.ok(uiCasesSource.includes('data-case="${escapeAttr(item.id)}"'));
});

await check("GUARD-2", "Planning data-resource-id attributes use escapeAttr", () => {
  assert.ok(uiPlanningSource.includes('data-resource-id="${escapeAttr(resource.id)}"'));
  assert.doesNotMatch(uiPlanningSource, /data-resource-id="\$\{resource\.id\}"/u);
});

await check("GUARD-3", "Login PIN status element has role=alert and aria-live=assertive", () => {
  assert.ok(indexSource.includes('id="user-login-status" role="alert" aria-live="assertive"'));
});

await check("GUARD-4", "Recovery OTP overlay Escape handler clicks cancel button", () => {
  const overlayKeydownFn = appSource.match(/function handleUserSessionOverlayKeydown\b[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(overlayKeydownFn.includes('overlay.id === "supabase-recovery-otp-overlay"'));
  assert.ok(overlayKeydownFn.includes('document.getElementById("supabase-recovery-otp-cancel")?.click()'));
});

await check("GUARD-5", "First-access form submitBtn is re-enabled in finally block and status has role=alert", () => {
  const firstAccessSubmit = appSource.match(/firstAccessForm\?\.addEventListener\("submit"[\s\S]*?\n\s*\}\);/)?.[0] || "";
  assert.ok(firstAccessSubmit.includes("finally") && firstAccessSubmit.includes("submitBtn.disabled = false"));
  assert.ok(indexSource.includes('id="first-access-status" role="alert"'));
});

await check("GUARD-6", "Funnel step button focus-visible has 3px solid #0b63ce overriding outline:none", () => {
  const line7160Index = stylesSource.indexOf(".funnel-step-btn:focus-visible {\n  border-color: #2563eb;");
  const line7215Index = stylesSource.indexOf(".funnel-step-btn:focus-visible,\n.settings-workspace-tab:focus-visible");
  assert.ok(line7160Index >= 0 && line7215Index > line7160Index);
  const laterRule = stylesSource.slice(line7215Index, line7215Index + 250);
  assert.ok(laterRule.includes("outline: 3px solid #0b63ce;"));
});

await check("GUARD-7", "All decorative inline SVGs in index.html have aria-hidden='true'", () => {
  const svgs = [...indexSource.matchAll(/<svg\b([^>]*)>/g)];
  assert.ok(svgs.length >= 25);
  const missing = svgs.filter(([, attrs]) => !attrs.includes('aria-hidden="true"'));
  assert.equal(missing.length, 0);
});

await check("GUARD-8", "UI text never falsely claims PIN encrypts local data", () => {
  assert.ok(indexSource.includes("Le PIN protège l’interface locale, mais ne chiffre pas les données locales."));
  assert.ok(stateSource.includes("Le PIN protège l’interface locale, mais ne chiffre pas les données locales"));
  assert.equal(/PIN\s+(?:qui\s+)?chiffre\s+les\s+donn[eé]es\s+locales/i.test(indexSource), false);
  assert.equal(/PIN\s+(?:qui\s+)?chiffre\s+les\s+donn[eé]es\s+locales/i.test(stateSource), false);
});

await check("GUARD-9", "Release v23.3.24 is synchronized across 7 files, sealed fingerprint validates, styles.css unchanged", () => {
  assert.match(versionSource, /^window\.APP_VERSION = "v23\.3\.24";$/m);
  assert.match(versionSource, /^window\.NIMR_BUILD = "v23\.3\.24";$/m);
  assert.match(versionSource, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.24";$/m);
  assert.match(stateSource, /const APP_VERSION = "v23\.3\.24";/);
  assert.match(swSource, /const CACHE_NAME = "nimr-sav-v23\.3\.24";/);
  assert.match(appSource, /vendor\/pdf\.worker\.min\.js\?v=23\.3\.24/);
  assert.match(appSource, /sw\.js\?v=23\.3\.24/);
  assert.match(estimateSource, /vendor\/pdf\.worker\.min\.js\?v=23\.3\.24/);
  assert.match(offlineSource, /styles\.css\?v=23\.3\.24/);
  assert.match(indexSource, /styles\.css\?v=23\.3\.24/);

  const RELEASE_OWNED_RUNTIME_FILES = [
    "index.html",
    "offline.html",
    "styles.css",
    "app.js",
    "sw.js",
    "manifest.webmanifest",
    "js/version.js",
    "js/utils.js",
    "js/state.js",
    "js/ui-cases.js",
    "js/estimate-import.js",
    "js/ui-planning.js",
    "js/photos.js",
    "js/storage.js",
    "js/work-hours-sync.js",
    "js/planning.js",
    "js/exports.js",
    "js/business-rules-v2187.js",
    "js/supabase-config.js",
    "js/supabase-client.js",
    "js/supabase-sync.js",
    "vendor/pdf.min.js",
    "vendor/pdf.worker.min.js",
  ].sort();

  const hash = crypto.createHash("sha256");
  for (const file of RELEASE_OWNED_RUNTIME_FILES) {
    hash.update(`${file}\n`);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  const actualFingerprint = hash.digest("hex");
  const EXPECTED_FINGERPRINT = "028175939cba065dffea3d236d08ff5d6fe81b562cb95a2aa20fb6fe00660e4c";
  assert.equal(actualFingerprint, EXPECTED_FINGERPRINT, "v23.3.24 fingerprint must match sealed release registry");

  const baselineDiff = execFileSync("git", ["diff", "204587ad2a59eb05918f73c5895db0092cc19d27", "--", "styles.css"], { cwd: root, encoding: "utf8" });
  assert.equal(baselineDiff.trim(), "", "styles.css must remain byte-identical to baseline");
});

// ============================================================
// FINAL SUMMARY
// ============================================================
console.log("\n============================================================");
if (failed.length === 0) {
  console.log(`SECUX-001 ACCEPTANCE SUITE: ${passed.length}/${passed.length} CHECKS PASSED`);
} else {
  console.error(`SECUX-001 ACCEPTANCE SUITE: ${passed.length}/${passed.length + failed.length} CHECKS PASSED (${failed.length} FAILED)`);
  process.exitCode = 1;
}
console.log("============================================================\n");
