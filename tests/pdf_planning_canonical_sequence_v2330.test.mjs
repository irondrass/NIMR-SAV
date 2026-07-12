import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const stateSource = fs.readFileSync(
  new URL("../js/state.js", import.meta.url),
  "utf8",
);
const appSource = fs.readFileSync(
  new URL("../app.js", import.meta.url),
  "utf8",
);
const planningSource = fs.readFileSync(
  new URL("../js/planning.js", import.meta.url),
  "utf8",
);
const syncSource = fs.readFileSync(
  new URL("../js/supabase-sync.js", import.meta.url),
  "utf8",
);

const start = stateSource.indexOf(
  "function normalizePdfPlanningTasksForCase(",
);
const end = stateSource.indexOf(
  "function normalizeWorkshopCaseStatus(",
  start,
);
assert.ok(start >= 0 && end > start);

const helperSource = stateSource.slice(start, end).trim();
assert.match(
  helperSource,
  /^function normalizePdfPlanningTasksForCase\(/,
);

const context = {};
vm.createContext(context);
vm.runInContext(helperSource, context);

const normalized = JSON.parse(
  vm.runInContext(
    `JSON.stringify(normalizePdfPlanningTasksForCase([
      {
        id: "pdf-task-reassembly",
        phase: "reassembly",
        dependencies: [],
      },
      {
        id: "pdf-task-body",
        phase: "body",
        dependencies: ["pdf-task-reassembly"],
      },
      {
        id: "pdf-task-prep",
        phase: "prep",
        dependencies: ["pdf-task-body"],
      },
      {
        id: "pdf-task-paint",
        phase: "paint",
        dependencies: ["pdf-task-prep"],
      },
    ]))`,
    context,
  ),
);

assert.deepEqual(
  normalized.map((task) => task.phase),
  ["body", "prep", "paint", "reassembly"],
);
assert.deepEqual(normalized[0].dependencies, []);
assert.deepEqual(
  normalized[1].dependencies,
  ["pdf-task-body"],
);
assert.deepEqual(
  normalized[2].dependencies,
  ["pdf-task-prep"],
);
assert.deepEqual(
  normalized[3].dependencies,
  ["pdf-task-paint"],
);

assert.match(
  appSource,
  /normalizePdfPlanningTasksForCase\(tasks\)/,
);
assert.match(
  planningSource,
  /item\?\.source === "pdf_estimate"[\s\S]*normalizePdfPlanningTasksForCase\(tasks\)/,
);
assert.match(
  stateSource,
  /pdfReadyForPlanning[\s\S]*return "planning"/,
);
assert.match(
  stateSource,
  /serverPlanningVersion:\s*Math\.max\(/,
);
assert.match(
  syncSource,
  /dependencies:\s*Array\.isArray\(step\.dependencies\)/,
);
assert.match(
  syncSource,
  /\.select\("planning_version"\)[\s\S]*\.eq\("local_id", planningCaseReference\)/,
);
assert.match(
  syncSource,
  /p_expected_version:\s*expectedPlanningVersion,/,
);
assert.doesNotMatch(
  syncSource,
  /p_case_id:\s*item\.id,/,
);

console.log(
  "PDF PLANNING CANONICAL SEQUENCE V23.3.0 OK",
);
