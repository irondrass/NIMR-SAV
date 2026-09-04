import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  RELEASE_OWNED_RUNTIME_FILES,
  normalizeBytesCRLF,
  FINGERPRINT_SCHEMES,
  CURRENT_FINGERPRINT_SCHEME,
  HISTORICAL_DIAGNOSIS,
  SEALED_RELEASE_FINGERPRINTS,
  computeReleaseFingerprint,
  computeLegacyWorktreeFingerprint,
  validateReleaseFingerprintContract,
  repositoryRoot,
} from "./helpers/release-fingerprint.mjs";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------------------------------------------------------------
// A. LF / CRLF EQUIVALENCE
// -------------------------------------------------------------
test("A. LF / CRLF equivalence: fixture bytes with LF and CRLF produce identical canonical fingerprints", () => {
  const lfContent = Buffer.from("function hello() {\n  const x = 1;\n  return x;\n}\n", "utf8");
  const crlfContent = Buffer.from("function hello() {\r\n  const x = 1;\r\n  return x;\r\n}\r\n", "utf8");

  // Prove the raw buffers are different
  assert.notEqual(lfContent.length, crlfContent.length);
  assert.equal(lfContent.equals(crlfContent), false);

  // Normalize at byte level
  const normalizedLF = normalizeBytesCRLF(lfContent);
  const normalizedCRLF = normalizeBytesCRLF(crlfContent);

  assert.equal(normalizedLF.equals(normalizedCRLF), true, "CRLF normalized bytes must match LF bytes exactly");

  // Hash across files fixture
  const customLF = { "app.js": lfContent };
  const customCRLF = { "app.js": crlfContent };

  const hashLF = computeReleaseFingerprint(repositoryRoot, ["app.js"], customLF);
  const hashCRLF = computeReleaseFingerprint(repositoryRoot, ["app.js"], customCRLF);

  assert.equal(hashLF, hashCRLF, "Canonical release fingerprint must be identical for LF and CRLF fixtures");
});

// -------------------------------------------------------------
// B. REAL MUTATION SENSITIVITY
// -------------------------------------------------------------
test("B. Real mutation sensitivity: changing one non-EOL byte changes fingerprint", () => {
  const base = Buffer.from("const status = 'ACTIVE';\n", "utf8");
  const mutated = Buffer.from("const status = 'ACT1VE';\n", "utf8");

  const hashBase = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": base });
  const hashMutated = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": mutated });

  assert.notEqual(hashBase, hashMutated, "Changing a non-EOL byte MUST produce a different fingerprint");
});

// -------------------------------------------------------------
// C. WHITESPACE SENSITIVITY
// -------------------------------------------------------------
test("C. Whitespace sensitivity: adding or removing a space changes fingerprint (no whitespace trimming)", () => {
  const base = Buffer.from("const x = 1;\n", "utf8");
  const spaceAdded = Buffer.from("const x = 1; \n", "utf8");
  const spaceRemoved = Buffer.from("const x= 1;\n", "utf8");

  const hashBase = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": base });
  const hashAdded = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": spaceAdded });
  const hashRemoved = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": spaceRemoved });

  assert.notEqual(hashBase, hashAdded, "Adding a trailing space MUST produce a different fingerprint");
  assert.notEqual(hashBase, hashRemoved, "Removing an inner space MUST produce a different fingerprint");
});

// -------------------------------------------------------------
// D. UNICODE STABILITY
// -------------------------------------------------------------
test("D. Unicode stability: Unicode characters and multibyte sequences remain deterministic", () => {
  // French vehicle and repair terminology with accents and special characters
  const unicodeTextLF = "/* Véhicule réparé: Carrosserie & Peinture — 1500€ — Clé reçue — 🚗 */\n";
  const unicodeTextCRLF = "/* Véhicule réparé: Carrosserie & Peinture — 1500€ — Clé reçue — 🚗 */\r\n";

  const bufLF = Buffer.from(unicodeTextLF, "utf8");
  const bufCRLF = Buffer.from(unicodeTextCRLF, "utf8");

  const normLF = normalizeBytesCRLF(bufLF);
  const normCRLF = normalizeBytesCRLF(bufCRLF);

  assert.equal(normLF.equals(normCRLF), true, "Unicode content with CRLF must normalize identically to LF");
  assert.equal(normLF.toString("utf8"), unicodeTextLF, "UTF-8 decode of normalized bytes must match original LF string");

  const hashLF = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": bufLF });
  const hashCRLF = computeReleaseFingerprint(repositoryRoot, ["app.js"], { "app.js": bufCRLF });
  assert.equal(hashLF, hashCRLF, "Unicode fingerprint must match regardless of CRLF or LF line endings");
});

// -------------------------------------------------------------
// BYTE-LEVEL NORMALIZATION EDGE CASES
// -------------------------------------------------------------
test("E. Lone CR (0x0D) preservation: lone CR is NOT collapsed or altered", () => {
  // Buffer with lone 0x0D not followed by 0x0A (e.g. classic Mac EOL or raw data)
  const loneCR = Buffer.from([0x61, 0x0d, 0x62]); // 'a\rb'
  const normalized = normalizeBytesCRLF(loneCR);

  assert.equal(normalized.length, 3);
  assert.equal(normalized.equals(loneCR), true, "Lone CR must not be removed or altered");
});

test("F. BOM preservation: UTF-8 BOM is preserved byte-for-byte", () => {
  const bomWithLF = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello\n", "utf8")]);
  const bomWithCRLF = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello\r\n", "utf8")]);

  const normLF = normalizeBytesCRLF(bomWithLF);
  const normCRLF = normalizeBytesCRLF(bomWithCRLF);

  assert.equal(normLF.equals(normCRLF), true);
  assert.equal(normLF[0], 0xef);
  assert.equal(normLF[1], 0xbb);
  assert.equal(normLF[2], 0xbf);
});

// -------------------------------------------------------------
// HISTORICAL DIAGNOSIS GUARD
// -------------------------------------------------------------
test("G. Historical diagnosis guard: document v23.3.24 legacy worktree vs canonical Git hash", () => {
  assert.equal(
    HISTORICAL_DIAGNOSIS.v23_3_24_LEGACY_WORKTREE_FINGERPRINT,
    "028175939cba065dffea3d236d08ff5d6fe81b562cb95a2aa20fb6fe00660e4c",
    "Historical legacy v23.3.24 worktree hash must be documented exactly"
  );
  assert.equal(
    HISTORICAL_DIAGNOSIS.v23_3_24_CANONICAL_GIT_FINGERPRINT,
    "4dfa8c42d372eafbc623a653a325c20979b52682c036c94daf823798b8cd00b0",
    "Historical canonical Git/live v23.3.24 hash must be documented exactly"
  );

  // Sealed registry for v23.3.24 MUST remain the historical legacy value
  assert.equal(
    SEALED_RELEASE_FINGERPRINTS["v23.3.24"],
    "028175939cba065dffea3d236d08ff5d6fe81b562cb95a2aa20fb6fe00660e4c",
    "Sealed registry entry for v23.3.24 MUST NOT be replaced by the Git hash"
  );
});

// -------------------------------------------------------------
// SCHEME VERSIONING CONTRACT
// -------------------------------------------------------------
test("H. Scheme versioning: legacy releases are worktree-raw-v1 and current is canonical-lf-v2", () => {
  assert.equal(FINGERPRINT_SCHEMES["v23.3.21"], "worktree-raw-v1");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.22"], "worktree-raw-v1");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.23"], "worktree-raw-v1");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.24"], "worktree-raw-v1");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.25"], "canonical-lf-v2");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.26"], "canonical-lf-v2");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.27"], "canonical-lf-v2");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.28"], "canonical-lf-v2");
  assert.equal(FINGERPRINT_SCHEMES["v23.3.29"], "canonical-lf-v2");
  assert.equal(CURRENT_FINGERPRINT_SCHEME, "canonical-lf-v2");
});

// -------------------------------------------------------------
// EXACT 23 RUNTIME-FILE INVENTORY
// -------------------------------------------------------------
test("I. Runtime files inventory: exactly 23 sorted release files declared", () => {
  assert.equal(RELEASE_OWNED_RUNTIME_FILES.length, 23);
  const sortedCopy = [...RELEASE_OWNED_RUNTIME_FILES].sort();
  assert.deepEqual(RELEASE_OWNED_RUNTIME_FILES, sortedCopy, "File list must be pre-sorted");

  // Verify each file exists on disk
  for (const file of RELEASE_OWNED_RUNTIME_FILES) {
    const fullPath = path.join(repositoryRoot, file);
    assert.equal(fs.existsSync(fullPath), true, `Release file must exist on disk: ${file}`);
  }
});

// -------------------------------------------------------------
// CROSS-EOL IN-MEMORY PROOF OVER FULL RUNTIME REPO
// -------------------------------------------------------------
test("J. Cross-EOL proof: normal worktree files vs in-memory CRLF version yield identical canonical fingerprint", () => {
  // Read current files
  const normalHash = computeReleaseFingerprint(repositoryRoot, RELEASE_OWNED_RUNTIME_FILES);

  // Construct in-memory CRLF version of all files
  const crlfMap = {};
  const lfMap = {};
  for (const file of RELEASE_OWNED_RUNTIME_FILES) {
    const content = fs.readFileSync(path.join(repositoryRoot, file));
    // convert any LF in content to CRLF (byte level)
    const normalizedToLF = normalizeBytesCRLF(content);
    lfMap[file] = normalizedToLF;

    // Convert LF (0x0A) -> CRLF (0x0D 0x0A)
    let lfCount = 0;
    for (let i = 0; i < normalizedToLF.length; i++) {
      if (normalizedToLF[i] === 0x0a) lfCount++;
    }
    const crlfBuf = Buffer.allocUnsafe(normalizedToLF.length + lfCount);
    let outIdx = 0;
    for (let i = 0; i < normalizedToLF.length; i++) {
      if (normalizedToLF[i] === 0x0a) {
        crlfBuf[outIdx++] = 0x0d;
        crlfBuf[outIdx++] = 0x0a;
      } else {
        crlfBuf[outIdx++] = normalizedToLF[i];
      }
    }
    crlfMap[file] = crlfBuf;
  }

  const inMemoryCRLFHash = computeReleaseFingerprint(repositoryRoot, RELEASE_OWNED_RUNTIME_FILES, crlfMap);
  const inMemoryLFHash = computeReleaseFingerprint(repositoryRoot, RELEASE_OWNED_RUNTIME_FILES, lfMap);

  assert.equal(normalHash, inMemoryLFHash, "Normal worktree canonical hash must match LF hash");
  assert.equal(inMemoryCRLFHash, inMemoryLFHash, "In-memory CRLF canonical hash must match LF hash");
  assert.equal(normalHash, inMemoryCRLFHash, "Normal worktree canonical hash must match in-memory CRLF hash");
});

// -------------------------------------------------------------
// RUNNER
// -------------------------------------------------------------
let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failed++;
  }
}

console.log(`\nFINGERPRINT PORTABILITY SUITE: ${passed}/${tests.length} CHECKS PASSED`);
if (failed > 0) {
  process.exit(1);
}
