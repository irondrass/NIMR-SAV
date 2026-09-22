import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(__dirname, "../..");

// Deterministic release fingerprint: SHA-256 over sorted release-owned runtime source files.
// Exactly 26 files whose byte content determines actual application runtime behavior.
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
  "js/vn-part-client.js",
  "js/vn-part-ui.js",
  "js/work-hours-sync.js",
  "manifest.webmanifest",
  "offline.html",
  "styles.css",
  "sw.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
  "vendor/xlsx.mini.min.js",
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
  "v23.3.26": "canonical-lf-v2",
  "v23.3.27": "canonical-lf-v2",
  "v23.3.28": "canonical-lf-v2",
  "v23.3.29": "canonical-lf-v2",
  "v23.3.30": "canonical-lf-v2",
  "v23.3.31": "canonical-lf-v2",
  "v23.3.32": "canonical-lf-v2",
  "v23.3.33": "canonical-lf-v2",
  "v23.3.34": "canonical-lf-v2",
  "v23.3.35": "canonical-lf-v2",
  "v23.3.36": "canonical-lf-v2",
  "v23.3.37": "canonical-lf-v2",
  "v23.3.38": "canonical-lf-v2",
  "v23.3.39": "canonical-lf-v2",
  "v23.3.40": "canonical-lf-v2",
  "v23.3.41": "canonical-lf-v2",
  "v23.3.42": "canonical-lf-v2",
  "v23.3.43": "canonical-lf-v2",
  "v23.3.44": "canonical-lf-v2",
  "v23.3.45": "canonical-lf-v2",
  "v23.3.46": "canonical-lf-v2",
  "v23.3.47": "canonical-lf-v2",
  "v23.3.48": "canonical-lf-v2",
  "v23.3.49": "canonical-lf-v2",
  "v23.3.50": "canonical-lf-v2",
  "v23.3.51": "canonical-lf-v2",
  "v23.3.52": "canonical-lf-v2",
  "v23.3.53": "canonical-lf-v2",
  "v23.3.54": "canonical-lf-v2",
  "v23.3.55": "canonical-lf-v2",
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
  "v23.3.26": "a9c7a3421f6940061d59be23659bd4105b79261a90db76429b7e2ec9e7ca6fe2",
  "v23.3.27": "b28c414446ed3486c0b6261241b76096999efcec81509f2e378173dbe8acadac",
  "v23.3.28": "3c3de28a415b05a27d7efd3704a12d29cc549d00d220d9c363883878350d3e6f",
  "v23.3.29": "824f9bb6f6c49fbbdd3ef29a27835e6686340ec5bab7ffa73805aa1b398db072",
  "v23.3.30": "e40ddb894efa0cde4db658ed02c4ece6609af324d74f56c86a475bd26a0b54ba",
  "v23.3.31": "b3e8d1ea2075cf463c01b4f982a642374fc5154210309e9819b7e760c90e6496",
  "v23.3.32": "c4a98d8477ad72fc8571b3c201dc7f8a5439a55fe562e3c7defb1baffca7fbb1",
  "v23.3.33": "87a4d70443427932709a7c5feec23c1170f0f7f728d2f3b4745c0caf7ee2ba8a",
  "v23.3.34": "61b4782c03c175a1b5bde44ab9f52f1990ff1e268740307c8485323db0b2e2b4",
  "v23.3.35": "65f6f4dc4a9a87bb3fd34517c04e0db827f6611fb1822cdaa1655040449d1bcd",
  "v23.3.36": "6e90dfc5c83614ddf8f47c7ab60b919c5090477fcc860f4983c911ace6075016",
  "v23.3.37": "c0e80e0e4737da96f80850aa29876a28d81737adc52584ea55891d32b27de878",
  "v23.3.38": "a766b1c90cffe77c824e7914dfdb8deb20a7620d709620ff66a98f2f6ef426a8",
  "v23.3.39": "f28c265de9e4520596329dc54cde69fb5b7064bd71c8dd127e1227ebb52c9454",
  "v23.3.40": "0250bc08b36c1d77ee557c7ce16f6623e3f8bcfc8514dd5287e7bbb428beee81",
  "v23.3.41": "4ca539ad9125425230dd7360ee42dd82b6d95237f55f3e5abf949a65b8a94e29",
  "v23.3.42": "90a07b4e0f5f229c57e411d04b27dac62ed4a19d26a4974421cee6c324da5d03",
  "v23.3.43": "6a7fa12d32bbe887be74fd3db82b6d2f46c672b050616756de845889b19a640b",
  "v23.3.44": "8a40172342cf24c69b06f8db1fa0395ad4c263b6a58ef45ad3302c0a2d35f20f",
  "v23.3.45": "95d3635433dc99c188dbb358ab5d52fda5e5faf915bb9189d979af1aa6cf3e68",
  "v23.3.46": "1bdae81ef8e4266733ac355c794c08c35e7b708f9217a01c5106f6f470a5c9e6",
  "v23.3.47": "1ffb6001a76a513c2f23a6742f25cec282e63bf6a67f802903b2c40e44cbb90b",
  "v23.3.48": "13a09266581574ad3da685a0b7d724294e9afcc3f490ef47a3d8bf807e00f30c",
  "v23.3.49": "0dcf7936a57c31a7ec832683b171c7b113637db7b9e71a5d705cbccddfa8344e",
  "v23.3.50": "3bcbe865559a44cd5961f5143b6989d14469bbd0e64cd4c7edc4b7deb91f8f5b",
  "v23.3.51": "2cdd66ed92b60a68456044f613f0391bf900af0f87f3bac41af6cd51d2a90fab",
  "v23.3.52": "11c56ee33c7e94725342a4d400b015ea2bc7253a74191d4573fb76996dbea884",
  "v23.3.53": "05b0f34c4332784403c2f71d155eb2e93a9d67c365cb2b5a66d85c15b7091ce9",
  "v23.3.54": "122b236f03e49af662ff73d042a0f197b2877e82a7ed9e5c331c3f6445bb1419",
  "v23.3.55": "66f2639461b6c2939b1ca9f3a37ee43c169014bad8ddb6b6ff4168b2d6929412",
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
      `1. Bump release identity (e.g. ${appVersion} -> next version, e.g. v23.3.30) across the authorized production files\n` +
      `2. Add a NEW sealed entry for the next version in SEALED_RELEASE_FINGERPRINTS while keeping ${appVersion} intact.`
    );
  }
  return true;
}
