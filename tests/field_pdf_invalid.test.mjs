import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invalidPdfPath = join(tmpdir(), `nimr-invalid-pdf-${process.pid}-${Date.now()}.pdf`);

function runFieldImport(pdfPath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ["tests/field_pdf_import.test.mjs", pdfPath], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

try {
  await writeFile(invalidPdfPath, "Ce fichier n'est pas un document PDF valide.\n", "utf8");
  const result = await runFieldImport(invalidPdfPath);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.code, 1, "un faux PDF doit provoquer un échec contrôlé");
  assert.match(output, /FIELD PDF IMPORT FAIL/);
  assert.match(output, /reason: Échec extraction PDF\.js/);
  assert.match(output, /error: PdfJsExtractionError/);
  assert.match(output, /message: Échec extraction PDF\.js/);
  assert.doesNotMatch(output, /webpackBootstrap|sourceMappingURL|function\s*\(webpack|PDFJS\.version/);
  assert.ok(output.length < 5_000, `le diagnostic PDF invalide est trop long (${output.length} caractères)`);

  const stackIndex = output.split(/\r?\n/).findIndex((line) => line.trim() === "stack:");
  if (stackIndex >= 0) {
    const stackFrames = output.split(/\r?\n/).slice(stackIndex + 1).filter((line) => /^\s{2}at\s/.test(line));
    assert.ok(stackFrames.length <= 3, `la stack doit contenir au maximum 3 lignes (${stackFrames.length})`);
  }

  console.log("FIELD PDF INVALID OK");
  console.log("reason: Échec extraction PDF.js");
} finally {
  await rm(invalidPdfPath, { force: true }).catch(() => null);
}
