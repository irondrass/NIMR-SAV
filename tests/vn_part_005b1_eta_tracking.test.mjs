import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKDIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const vnPartUi = require(path.join(WORKDIR, "js", "vn-part-ui.js"));
const uiJsContent = fs.readFileSync(
  path.join(WORKDIR, "js", "vn-part-ui.js"),
  "utf8"
);

function openRemoval(overrides = {}) {
  return {
    id: "rem-base",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    donor_vin: "LDP43A963SS112296",
    donor_model: "SHINE",
    part_reference: "REF-001",
    part_designation: "Optique AVG",
    expected_replacement_date: null,
    replacement_available_at: null,
    restored_at: null,
    removed_at: "2026-09-10T09:00:00Z",
    ...overrides,
  };
}

// ============================================================================
// 1. Deterministic ETA classification
// ============================================================================

test("005B1-1: ETA classifier distinguishes missing, today, overdue and upcoming", () => {
  assert.equal(
    typeof vnPartUi.classifyEtaTracking,
    "function",
    "ETA005B1_RED_CLASSIFIER_MISSING"
  );

  const today = "2026-09-15";

  const missing = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: null }),
    today
  );

  assert.equal(missing.trackable, true);
  assert.equal(missing.category, "MISSING_ETA");
  assert.equal(missing.needsFollowUpToday, false);

  const dueToday = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: "2026-09-15" }),
    today
  );

  assert.equal(dueToday.category, "DUE_TODAY");
  assert.equal(dueToday.daysFromEta, 0);
  assert.equal(dueToday.needsFollowUpToday, true);

  const d1 = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: "2026-09-14" }),
    today
  );

  assert.equal(d1.category, "OVERDUE");
  assert.equal(d1.daysFromEta, 1);
  assert.equal(d1.needsFollowUpToday, true);

  const d2 = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: "2026-09-13" }),
    today
  );

  assert.equal(d2.category, "OVERDUE");
  assert.equal(d2.daysFromEta, 2);
  assert.equal(d2.needsFollowUpToday, false);

  const d3 = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: "2026-09-12" }),
    today
  );

  assert.equal(d3.category, "OVERDUE");
  assert.equal(d3.daysFromEta, 3);
  assert.equal(d3.needsFollowUpToday, true);

  const upcoming = vnPartUi.classifyEtaTracking(
    openRemoval({ expected_replacement_date: "2026-09-20" }),
    today
  );

  assert.equal(upcoming.category, "UPCOMING");
  assert.equal(upcoming.needsFollowUpToday, false);
});

// ============================================================================
// 2. D0 / D+1 / D+3 / D+5... cadence
// ============================================================================

test("005B1-2: Follow-up cadence is D0, D+1, then every 2 days", () => {
  assert.equal(
    typeof vnPartUi.classifyEtaTracking,
    "function",
    "ETA005B1_RED_CADENCE_MISSING"
  );

  const today = "2026-09-15";

  const cases = [
    ["2026-09-15", 0, true],
    ["2026-09-14", 1, true],
    ["2026-09-13", 2, false],
    ["2026-09-12", 3, true],
    ["2026-09-11", 4, false],
    ["2026-09-10", 5, true],
    ["2026-09-09", 6, false],
    ["2026-09-08", 7, true],
  ];

  for (const [eta, days, expected] of cases) {
    const result = vnPartUi.classifyEtaTracking(
      openRemoval({ expected_replacement_date: eta }),
      today
    );

    assert.equal(
      result.daysFromEta,
      days,
      `Unexpected daysFromEta for ETA ${eta}`
    );

    assert.equal(
      result.needsFollowUpToday,
      expected,
      `Unexpected follow-up decision for D+${days}`
    );
  }
});

// ============================================================================
// 3. Resolved / terminal records must disappear automatically
// ============================================================================

test("005B1-3: Available, restored and terminal records are excluded from ETA tracking", () => {
  assert.equal(
    typeof vnPartUi.classifyEtaTracking,
    "function",
    "ETA005B1_RED_EXCLUSION_MISSING"
  );

  const today = "2026-09-15";

  const excluded = [
    openRemoval({
      replacement_available_at: "2026-09-15T08:00:00Z",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      restored_at: "2026-09-15T10:00:00Z",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      status: "REFUSE",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      status: "ANNULE",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      status: "CLOTURE",
      expected_replacement_date: "2026-09-14",
    }),
  ];

  for (const removal of excluded) {
    const result = vnPartUi.classifyEtaTracking(removal, today);

    assert.equal(
      result.trackable,
      false,
      `Resolved/terminal removal still tracked: ${removal.status}`
    );
  }
});

// ============================================================================
// 4. Aggregate operational counters
// ============================================================================

test("005B1-4: ETA summary exposes missing, due-today, overdue and follow-up counters", () => {
  assert.equal(
    typeof vnPartUi.computeEtaTrackingSummary,
    "function",
    "ETA005B1_RED_SUMMARY_MISSING"
  );

  const today = "2026-09-15";

  const removals = [
    openRemoval({
      id: "missing",
      expected_replacement_date: null,
    }),
    openRemoval({
      id: "today",
      expected_replacement_date: "2026-09-15",
    }),
    openRemoval({
      id: "d1",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      id: "d2",
      expected_replacement_date: "2026-09-13",
    }),
    openRemoval({
      id: "d3",
      expected_replacement_date: "2026-09-12",
    }),
    openRemoval({
      id: "future",
      expected_replacement_date: "2026-09-20",
    }),
    openRemoval({
      id: "resolved",
      expected_replacement_date: "2026-09-10",
      replacement_available_at: "2026-09-15T07:00:00Z",
    }),
  ];

  const summary = vnPartUi.computeEtaTrackingSummary(removals, today);

  assert.deepEqual(
    {
      missing: summary.etaMissingCount,
      dueToday: summary.etaDueTodayCount,
      overdue: summary.etaOverdueCount,
      followUpToday: summary.followUpTodayCount,
      trackable: summary.trackableCount,
    },
    {
      missing: 1,
      dueToday: 1,
      overdue: 3,
      followUpToday: 3,
      trackable: 6,
    }
  );
});

// ============================================================================
// 5. Operational filtering
// ============================================================================

test("005B1-5: ETA filters expose all, missing, overdue and follow-up queues", () => {
  assert.equal(
    typeof vnPartUi.filterEtaTrackingRows,
    "function",
    "ETA005B1_RED_FILTER_MISSING"
  );

  const today = "2026-09-15";

  const removals = [
    openRemoval({
      id: "missing",
      expected_replacement_date: null,
    }),
    openRemoval({
      id: "today",
      expected_replacement_date: "2026-09-15",
    }),
    openRemoval({
      id: "d1",
      expected_replacement_date: "2026-09-14",
    }),
    openRemoval({
      id: "d2",
      expected_replacement_date: "2026-09-13",
    }),
    openRemoval({
      id: "future",
      expected_replacement_date: "2026-09-20",
    }),
  ];

  assert.deepEqual(
    vnPartUi
      .filterEtaTrackingRows(removals, "missing", today)
      .map((r) => r.removal.id),
    ["missing"]
  );

  assert.deepEqual(
    vnPartUi
      .filterEtaTrackingRows(removals, "overdue", today)
      .map((r) => r.removal.id)
      .sort(),
    ["d1", "d2"]
  );

  assert.deepEqual(
    vnPartUi
      .filterEtaTrackingRows(removals, "followup", today)
      .map((r) => r.removal.id)
      .sort(),
    ["d1", "today"]
  );

  assert.equal(
    vnPartUi.filterEtaTrackingRows(removals, "all", today).length,
    5
  );
});

// ============================================================================
// 6. UI contract
// ============================================================================

test("005B1-6: VN-PART renders an ETA operational section with the four filters", () => {
  assert.match(
    uiJsContent,
    /id="vn-part-eta-section"/u,
    "ETA005B1_RED_UI_SECTION_MISSING"
  );

  assert.match(
    uiJsContent,
    /ÉCHÉANCES PIÈCES/u,
    "ETA section title missing"
  );

  // The renderer emits one generic data attribute through filterButton(),
  // then invokes that helper explicitly for the four supported queues.
  assert.match(
    uiJsContent,
    /data-eta-filter="\$\{filter\}"/u,
    "ETA filter renderer must emit data-eta-filter from its filter argument"
  );

  for (const filter of ["all", "missing", "overdue", "followup"]) {
    assert.match(
      uiJsContent,
      new RegExp(`filterButton\\("${filter}"`, "u"),
      `ETA filter invocation missing: ${filter}`
    );
  }

  assert.match(
    uiJsContent,
    /ETA manquante/u,
    "ETA missing label absent"
  );

  assert.match(
    uiJsContent,
    /À relancer aujourd'hui/u,
    "ETA follow-up label absent"
  );
});