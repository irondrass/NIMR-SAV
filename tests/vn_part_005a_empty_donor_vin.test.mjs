import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPath = path.resolve(
  __dirname,
  "../supabase/migrations/20260915200500_vn_part_005a_donor_vin17_guard.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");
const normalized = sql.replace(/\r\n/g, "\n");

test("005A-EMPTY-1: NULL donor VIN remains permitted before donor assignment", () => {
  assert.match(
    normalized,
    /new\.donor_vin\s+is\s+null/i,
    "NULL_DONOR_VIN_PREASSIGNMENT_MUST_REMAIN_ALLOWED"
  );
});

test("005A-EMPTY-2: blank donor VIN must not bypass the authoritative VIN17 guard", () => {
  const blankBypass =
    /if\s+new\.donor_vin\s+is\s+null\s+or\s+(?:btrim|trim)\s*\(\s*new\.donor_vin\s*\)\s*=\s*''\s+then\s+return\s+new\s*;/i;

  assert.equal(
    blankBypass.test(normalized.replace(/\s+/g, " ")),
    false,
    "EMPTY_DONOR_VIN_MUST_NOT_BYPASS_GUARD"
  );
});

test("005A-EMPTY-3: authoritative VIN17 rejection contract remains present", () => {
  assert.match(
    normalized,
    /INVALID_DONOR_VIN/,
    "INVALID_DONOR_VIN rejection must remain authoritative"
  );

  assert.match(
    normalized,
    /\[A-HJ-NPR-Z0-9\]\{17\}/,
    "Strict 17-character VIN charset contract must remain present"
  );
});