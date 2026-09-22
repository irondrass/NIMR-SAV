import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const clientSource = fs.readFileSync(
  new URL("../js/supabase-client.js", import.meta.url),
  "utf8",
);

const migrationSource = fs.readFileSync(
  new URL("../supabase/migrations/20260922210000_lot20b_qc_v3_server.sql", import.meta.url),
  "utf8",
);

const cutoverSource = fs.readFileSync(
  new URL("../supabase/migrations/20260922220000_lot20b_qc_authority_cutover.sql", import.meta.url),
  "utf8",
);

test("QC client sends the version actually observed by the UI", () => {
  const start = clientSource.indexOf("async function submitSupabaseQualityReview");
  const end = clientSource.indexOf("window.submitSupabaseQualityReview", start);
  assert.ok(start >= 0 && end > start, "submitSupabaseQualityReview must exist");
  const body = clientSource.slice(start, end);

  assert.match(body, /getObservedGranularServerVersion/);
  assert.match(body, /CASE_VERSION_NOT_OBSERVED/);
  assert.match(body, /p_base_version:\s*Number\(observedBaseVersion\)/);

  assert.doesNotMatch(
    body,
    /\.from\("sync_entities"\)[\s\S]*?\.select\("entity_version"\)/,
    "QC must not refresh the server version immediately before CAS because that defeats stale-view detection",
  );
});

test("QC v3 server blocks invalid timing and hidden status transitions", () => {
  assert.match(
    migrationSource,
    /clean_status not in \('validated','rejected'\)/,
  );
  assert.match(
    migrationSource,
    /flags->>'delivered'[\s\S]*?Le dossier livré ou archivé/,
  );
  assert.match(
    migrationSource,
    /flags->>'workCompleted'[\s\S]*?Terminer les travaux avant le contrôle qualité/,
  );
});


test("CUTOVER preserves neutral case creation while blocking prevalidated inserts", () => {
  assert.match(
    cutoverSource,
    /if tg_op='INSERT' then/,
    "CUTOVER must treat initial case creation separately from QC updates",
  );
  assert.match(
    cutoverSource,
    /insert_quality_status not in \('','not_started'\)/,
    "A new case may only start with a neutral QC status",
  );
  assert.match(
    cutoverSource,
    /new case cannot contain completed quality decision state/,
    "A new case must not be insertable as already quality-approved/rejected",
  );
  assert.match(
    cutoverSource,
    /quality domain changes must use nimr_apply_quality_review_v3/,
    "QC updates must still be restricted to the dedicated QC RPC",
  );
});
