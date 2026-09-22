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
