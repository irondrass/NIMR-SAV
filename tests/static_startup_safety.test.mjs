import assert from "node:assert/strict";
import fs from "node:fs";

const startupFiles = [
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/planning.js",
  "js/exports.js",
  "js/photos.js",
  "app.js",
];

const sources = Object.fromEntries(
  startupFiles.map((file) => [file, fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")]),
);
const loadedSource = Object.values(sources).join("\n");

const requiredHelpers = [
  "normalizeCaseStatusFilter",
  "guardSensitiveAction",
  "isCaseReadonlyArchive",
  "getCaseStatus",
  "normalizePlanningRole",
  "isLegacyPlanningEntry",
  "isAnticipatedPartsPreparation",
  "safeQuerySelector",
  "setHtmlIfExists",
  "setTextIfExists",
  "bindIfExists",
];

for (const helper of requiredHelpers) {
  assert.match(
    loadedSource,
    new RegExp(`function\\s+${helper}\\s*\\(|(?:const|let|var)\\s+${helper}\\s*=`),
    `${helper} doit être défini dans les scripts chargés au démarrage`,
  );
  assert.match(
    loadedSource,
    new RegExp(`window\\.${helper}\\s*=\\s*${helper}`),
    `${helper} doit être exposé sur window pour les scripts non modules`,
  );
}

const startupDomSource = [
  sources["js/ui-cases.js"],
  sources["app.js"],
  sources["js/planning.js"],
  sources["js/photos.js"],
  sources["js/exports.js"],
].join("\n");

const forbiddenPatterns = [
  {
    pattern: /document\.querySelector\([^;\n]+\)\.innerHTML\s*=/,
    label: "document.querySelector(...).innerHTML sans garde",
  },
  {
    pattern: /document\.getElementById\([^;\n]+\)\.innerHTML\s*=/,
    label: "document.getElementById(...).innerHTML sans garde",
  },
  {
    pattern: /\$\("#photo-input",\s*detail\)\.addEventListener\(/,
    label: "photo-input obligatoire dans renderCaseDetail",
  },
  {
    pattern: /\$\("#generate-proposals",\s*detail\)\.addEventListener\(/,
    label: "generate-proposals obligatoire dans renderCaseDetail",
  },
  {
    pattern: /\$\("#print-repair-order",\s*detail\)\.addEventListener\(/,
    label: "print-repair-order obligatoire dans renderCaseDetail",
  },
  {
    pattern: /\$\("\[data-field='status'\]",\s*detail\)\.textContent\s*=/,
    label: "status obligatoire dans renderCaseDetail",
  },
  {
    pattern: /\$\("\[data-field='chef-state'\]",\s*detail\)\.innerHTML\s*=/,
    label: "chef-state obligatoire dans renderCaseDetail",
  },
];

for (const { pattern, label } of forbiddenPatterns) {
  assert.equal(pattern.test(startupDomSource), false, `${label} interdit`);
}

assert.match(
  sources["js/ui-cases.js"],
  /function\s+renderCaseDetail\s*\(\)\s*{[\s\S]*if\s*\(!detail\)\s*return;[\s\S]*if\s*\(!template\?\.content\)/,
  "renderCaseDetail doit ignorer proprement un conteneur ou template absent",
);
assert.match(
  sources["js/ui-cases.js"],
  /function\s+renderPhotos\s*\([^)]*\)\s*{[\s\S]*const photos = [^;]+;[\s\S]*if\s*\(!photos\)\s*return;/,
  "renderPhotos doit ignorer proprement le bloc photos absent",
);

const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const versionJs = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
assert.equal(/v=23\.2\.6/.test(indexHtml), false, "index.html ne doit plus référencer l'ancien cache-bust 23.2.6");
assert.match(indexHtml, /v=23\.2\.7-hotfix-startup/, "index.html doit pointer sur la version hotfix startup");
assert.match(serviceWorker, /nimr-sav-v23\.2\.7-hotfix-startup/, "sw.js doit invalider l'ancien cache PWA");
assert.match(versionJs, /nimr-sav-v23\.2\.7-hotfix-startup/, "js/version.js doit déclarer le nouveau cache");

console.log("Static startup safety regression OK");
