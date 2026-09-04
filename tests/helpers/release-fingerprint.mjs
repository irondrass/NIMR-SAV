import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(__dirname, "../..");

// Deterministic release fingerprint: SHA-256 over sorted release-owned runtime source files.
// Exactly 23 files whose byte content determines actual application runtime behavior.
export const RELEASE_OWNED_RUNTIME_FILES = Object.freeze([
  "app.js",
  "index.html",
  "js/business-rules-v2187.js",
  "js/estimate-import.js",
  "js/exports.js",
  "js/photos.js",
  "js/planning.js",
  "js/state.js",
  "js/storage.js",
  "js/supabase-client.js",
  "js/supabase-config.js",
  "js/supabase-sync.js",
  "js/ui-cases.js",
  "js/ui-planning.js",
  "js/utils.js",
  "js/version.js",
  "js/work-hours-sync.js",
  "manifest.webmanifest",
  "offline.html",
  "styles.css",
  "sw.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
]);

/**
 * Normalizes CRLF (0x0D 0x0A) to LF (0x0A) strictly at the byte level.
 * Preserves lone 0x0D, BOMs, Unicode bytes, and all other bytes unmodified.
 * Does not convert Buffer -> UTF-8 string -> Buffer.
 *
 * @param {Buffer|Uint8Array} input
 * @returns {Buffer}
 */
export function normalizeBytesCRLF(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const len = buffer.length;
  let crlfCount = 0;
  for (let i = 0; i < len - 1; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) {
      crlfCount++;
      i++;
    }
  }
  if (crlfCount === 0) {
    return buffer;
  }
  const out = Buffer.allocUnsafe(len - crlfCount);
  let outIdx = 0;
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0x0d && i + 1 < len && buffer[i + 1] === 0x0a) {
      out[outIdx++] = 0x0a;
      i++;
    } else {
      out[outIdx++] = buffer[i];
    }
  }
  return out;
}

// FINGERPRINT SCHEME VERSIONING
// Historical releases v23.3.21 through v23.3.24 remain immutable legacy records sealed with 'worktree-raw-v1'.
// v23.3.25 is the FIRST release sealed with 'canonical-lf-v2' (CRLF byte normalization).
export const FINGERPRINT_SCHEMES = Object.freeze({
  "v23.3.21": "worktree-raw-v1",
  "v23.3.22": "worktree-raw-v1",
  "v23.3.23": "worktree-raw-v1",
  "v23.3.24": "worktree-raw-v1",
  "v23.3.25": "canonical-lf-v2",
});

export const CURRENT_FINGERPRINT_SCHEME = "canonical-lf-v2";

// HISTORICAL DIAGNOSIS GUARD
// Documents historical v23.3.24 worktree hash vs canonical Git/live hash.
// They are intentionally distinct due to Windows worktree CRLF checkout in legacy scheme.
export const HISTORICAL_DIAGNOSIS = Object.freeze({
  v23_3_24_LEGACY_WORKTREE_FINGERPRINT: "028175939cba065dffea3d236d08ff5d6fe81b562cb95a2aa20fb6fe00660e4c",
  v23_3_24_CANONICAL_GIT_FINGERPRINT: "4dfa8c42d372eafbc623a653a325c20979b52682c036c94daf823798b8cd00b0",
});

// SEALED RELEASE FINGERPRINT REGISTRY (TEST-ONLY)
// Each released version's fingerprint is immutable and SEALED.
// When application runtime source changes, you CANNOT update an existing sealed entry.
// You MUST bump the release identity (e.g. v23.3.24 -> v23.3.25) and add a NEW entry.
export const SEALED_RELEASE_FINGERPRINTS = Object.freeze({
  "v23.3.21": "86bf96cb1c8c54d46cff5ffb2de8e12eb72524239ed55c4c6c0642326496a1ee",
  "v23.3.22": "e6d20482965e4e76bfe488ba4fb9fb5c63485e037611c34ede24880cfbd61bb4",
  "v23.3.23": "76482e4c0265966a7c0088e9ce4f43d59ac540b364d310cc73c68b413d06e76c",
  "v23.3.24": "028175939cba065dffea3d236d08ff5d6fe81b562cb95a2aa20fb6fe00660e4c",
  "v23.3.25": "c0084d697aa781797f8100b488fb3ab8c638354bee3b5d27add9c18e685038d8",
});

/**
 * Computes the canonical release fingerprint (canonical-lf-v2).
 * For each sorted runtime file:
 *   updates hash with `<path>\n`
 *   updates hash with canonical bytes (normalizeBytesCRLF)
 *
 * @param {string} [rootPath=repositoryRoot] Repository root directory
 * @param {readonly string[]} [fileList=RELEASE_OWNED_RUNTIME_FILES] List of relative file paths
 * @param {Record<string, Buffer|string>|null} [customContentMap=null] Optional in-memory overrides
 * @returns {string} SHA-256 hex digest
 */
export function computeReleaseFingerprint(rootPath = repositoryRoot, fileList = RELEASE_OWNED_RUNTIME_FILES, customContentMap = null) {
  const hash = crypto.createHash("sha256");
  const sortedFiles = [...fileList].sort();
  for (const file of sortedFiles) {
    let rawContent;
    if (customContentMap && Object.prototype.hasOwnProperty.call(customContentMap, file)) {
      rawContent = customContentMap[file];
      if (!Buffer.isBuffer(rawContent)) {
        rawContent = Buffer.from(rawContent);
      }
    } else {
      rawContent = fs.readFileSync(path.join(rootPath, file));
    }
    const canonicalContent = normalizeBytesCRLF(rawContent);
    hash.update(`${file}\n`);
    hash.update(canonicalContent);
  }
  return hash.digest("hex");
}

/**
 * Computes legacy raw-worktree fingerprint (worktree-raw-v1).
 * Kept for historical verification and diagnosis only.
 *
 * @param {string} [rootPath=repositoryRoot] Repository root directory
 * @param {readonly string[]} [fileList=RELEASE_OWNED_RUNTIME_FILES] List of relative file paths
 * @returns {string} SHA-256 hex digest
 */
export function computeLegacyWorktreeFingerprint(rootPath = repositoryRoot, fileList = RELEASE_OWNED_RUNTIME_FILES) {
  const hash = crypto.createHash("sha256");
  const sortedFiles = [...fileList].sort();
  for (const file of sortedFiles) {
    const rawContent = fs.readFileSync(path.join(rootPath, file));
    hash.update(`${file}\n`);
    hash.update(rawContent);
  }
  return hash.digest("hex");
}

export function validateReleaseFingerprintContract({
  appVersion,
  actualFingerprint,
  registry = SEALED_RELEASE_FINGERPRINTS,
}) {
  if (!registry[appVersion]) {
    throw new Error(
      `UNREGISTERED RELEASE: Release ${appVersion} is not present in the sealed release registry.\n` +
      `Add a new sealed entry for ${appVersion} in SEALED_RELEASE_FINGERPRINTS.`
    );
  }
  const sealedFingerprint = registry[appVersion];
  if (actualFingerprint !== sealedFingerprint) {
    throw new Error(
      `SEALED RELEASE MUTATION FORBIDDEN: Runtime source has changed under sealed release ${appVersion}.\n` +
      `Release ${appVersion} is SEALED and must NEVER be rewritten in place.\n` +
      `DO NOT update the sealed fingerprint for ${appVersion}.\n` +
      `To ship this runtime change, you MUST create a NEW release:\n` +
      `1. Bump release identity (e.g. ${appVersion} -> next version, e.g. v23.3.26) across the authorized production files\n` +
      `2. Add a NEW sealed entry for the next version in SEALED_RELEASE_FINGERPRINTS while keeping ${appVersion} intact.`
    );
  }
  return true;
}
