import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartUi = require("../js/vn-part-ui.js");

const { classifyEtaTracking } = vnPartUi;

assert.equal(
  typeof classifyEtaTracking,
  "function",
  "classifyEtaTracking must remain exported"
);

const TODAY = "2026-09-15";

function removal(overrides = {}) {
  return {
    id: "rem-scope-test",
    status: "PRELEVE_EN_ATTENTE_PIECE",
    expected_replacement_date: "2026-09-14",
    replacement_available_at: null,
    restored_at: null,
    ...overrides,
  };
}

test("005B1-SCOPE-1: EN_ATTENTE_VALIDATIONS is never tracked even when ETA exists", () => {
  const result = classifyEtaTracking(
    removal({
      status: "EN_ATTENTE_VALIDATIONS",
      expected_replacement_date: "2026-09-14",
    }),
    TODAY
  );

  assert.equal(
    result.trackable,
    false,
    "ETA_SCOPE_RED_PENDING_VALIDATION_MUST_NOT_BE_TRACKED"
  );
});

test("005B1-SCOPE-2: AUTORISE_A_PRELEVER is never tracked even when ETA exists", () => {
  const result = classifyEtaTracking(
    removal({
      status: "AUTORISE_A_PRELEVER",
      expected_replacement_date: "2026-09-14",
    }),
    TODAY
  );

  assert.equal(
    result.trackable,
    false,
    "ETA_SCOPE_RED_AUTHORIZED_NOT_REMOVED_MUST_NOT_BE_TRACKED"
  );
});

test("005B1-SCOPE-3: PRELEVE_EN_ATTENTE_PIECE with ETA remains trackable", () => {
  const result = classifyEtaTracking(
    removal({
      status: "PRELEVE_EN_ATTENTE_PIECE",
      expected_replacement_date: "2026-09-14",
    }),
    TODAY
  );

  assert.equal(result.trackable, true);
  assert.equal(result.category, "OVERDUE");
});

test("005B1-SCOPE-4: PRELEVE_EN_ATTENTE_PIECE without ETA remains trackable as MISSING_ETA", () => {
  const result = classifyEtaTracking(
    removal({
      status: "PRELEVE_EN_ATTENTE_PIECE",
      expected_replacement_date: null,
    }),
    TODAY
  );

  assert.equal(result.trackable, true);
  assert.equal(result.category, "MISSING_ETA");
});