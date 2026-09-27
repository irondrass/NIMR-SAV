import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260927110000_qc_gate0_legacy_quality_rpc_cutover.sql",
    import.meta.url,
  ),
  "utf8",
);

const client = fs.readFileSync(
  new URL("../js/supabase-client.js", import.meta.url),
  "utf8",
);

const normalized = migration
  .replace(/\s+/gu, " ")
  .trim()
  .toLowerCase();

test("legacy V1/V2 RPC execution is revoked from browser roles", () => {
  const expected = [
    "revoke all on function public.nimr_apply_quality_review_v1( uuid,text,text,text,text ) from public, anon, authenticated;",
    "revoke all on function nimr_internal.nimr_apply_quality_review_v1( uuid,text,text,text,text ) from public, anon, authenticated;",
    "revoke all on function public.nimr_apply_quality_review_v2( uuid,text,text,text,text,bigint ) from public, anon, authenticated;",
    "revoke all on function nimr_internal.nimr_apply_quality_review_v2( uuid,text,text,text,text,bigint ) from public, anon, authenticated;",
  ];

  for (const statement of expected) {
    assert.ok(
      normalized.includes(statement),
      `missing revoke: ${statement}`,
    );
  }
});

test("canonical authenticated V3 is a preflight prerequisite", () => {
  assert.match(
    migration,
    /public\.nimr_apply_quality_review_v3\(uuid,text,text,text,text,jsonb,text,bigint\)/u,
  );

  assert.match(
    migration,
    /has_function_privilege\([\s\S]*?'authenticated'[\s\S]*?v3[\s\S]*?'EXECUTE'/u,
  );

  assert.match(
    migration,
    /using errcode='55000'/u,
  );
});

test("migration changes privileges only", () => {
  assert.doesNotMatch(
    migration,
    /create\s+or\s+replace\s+function|create\s+trigger|drop\s+trigger|alter\s+table/iu,
  );

  assert.doesNotMatch(
    migration,
    /grant\s+execute/iu,
  );
});

test("browser uses QC V3 and not V1/V2", () => {
  assert.match(
    client,
    /\.rpc\("nimr_apply_quality_review_v3"/u,
  );

  assert.doesNotMatch(
    client,
    /\.rpc\("nimr_apply_quality_review_v[12]"/u,
  );
});