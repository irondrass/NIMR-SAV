import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pdfPath = process.argv[2] || process.env.NIMR_FIELD_PDF || "";
if (!pdfPath) {
  console.error("Usage: node tests\\pdf_to_archive_e2e.test.mjs <chemin-du-pdf-reel>");
  process.exit(1);
}

const fieldTest = new URL("./field_pdf_import.test.mjs", import.meta.url);
const result = spawnSync(process.execPath, [fileURLToPath(fieldTest), resolve(pdfPath)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, NIMR_PDF_TO_ARCHIVE: "1" },
  encoding: "utf8",
  timeout: 180_000,
  maxBuffer: 1024 * 1024,
});

const stdout = String(result.stdout || "");
const stderr = String(result.stderr || "");
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

assert.equal(result.status, 0, "le parcours PDF réel jusqu'à l'archive doit réussir");
assert.match(stdout, /FIELD PDF IMPORT OK/u);
assert.match(stdout, /PDF TO ARCHIVE E2E OK/u);
assert.doesNotMatch(`${stdout}\n${stderr}`, /FIELD PDF IMPORT FAIL/u);
assert.ok(`${stdout}\n${stderr}`.length < 20_000, "la sortie E2E doit rester bornée et lisible");
