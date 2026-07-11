import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, "..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}`;
  const signatureIndex = source.indexOf(signature);
  assert.notEqual(signatureIndex, -1, `${signature} est introuvable`);

  const bodyStart = source.indexOf("{", signatureIndex + signature.length);
  assert.notEqual(bodyStart, -1, `le corps de ${functionName} est introuvable`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(signatureIndex, index + 1);
    }
  }

  assert.fail(`le corps de ${functionName} n'est pas correctement fermé`);
}

const checks = [];

function check(label, assertion) {
  try {
    assertion();
    checks.push({ label, ok: true });
    console.log(`OK - ${label}`);
  } catch (error) {
    checks.push({ label, ok: false, error });
    console.error(`FAIL - ${label}`);
    console.error(`reason: ${error.message}`);
  }
}

const indexSource = readRepositoryFile("index.html");
const appSource = readRepositoryFile("app.js");
const stateSource = readRepositoryFile(path.join("js", "state.js"));
const serviceWorkerSource = readRepositoryFile("sw.js");

check("les textes PDF-first sont présents et les anciens textes sont absents", () => {
  const requiredTexts = [
    "Import devis PDF atelier",
    "Importez le devis PDF pour créer automatiquement le dossier, les travaux et la préparation planning.",
    "Importer un devis PDF",
    "Créer dossier depuis devis PDF",
  ];
  const forbiddenTexts = [
    "Réception guidée",
    "Créer un nouveau dossier",
    "Motifs fréquents",
    "Réclamations client",
    "Demandes client",
    "Client démonstration",
  ];

  requiredTexts.forEach((text) => {
    assert.ok(indexSource.includes(text), `texte PDF-first manquant : « ${text} »`);
  });
  forbiddenTexts.forEach((text) => {
    assert.equal(indexSource.includes(text), false, `ancien texte encore présent : « ${text} »`);
  });
});

check("les scripts de démarrage requis existent et sont chargés dans un ordre cohérent", () => {
  const scriptSources = [...indexSource.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
  const localScripts = scriptSources
    .filter((source) => !/^(?:https?:)?\/\//iu.test(source))
    .map((source) => source.split(/[?#]/u, 1)[0].replace(/^\.\//u, ""));
  const requiredOrder = [
    "js/version.js",
    "vendor/pdf.min.js",
    "js/utils.js",
    "js/state.js",
    "js/ui-cases.js",
    "js/estimate-import.js",
    "js/ui-planning.js",
    "js/photos.js",
    "js/storage.js",
    "js/planning.js",
    "js/exports.js",
    "js/business-rules-v2187.js",
    "js/supabase-config.js",
    "js/supabase-client.js",
    "js/supabase-sync.js",
    "app.js",
  ];

  let previousIndex = -1;
  requiredOrder.forEach((script) => {
    const scriptIndex = localScripts.indexOf(script);
    assert.notEqual(scriptIndex, -1, `script requis absent de index.html : ${script}`);
    assert.ok(scriptIndex > previousIndex, `ordre de chargement incohérent autour de ${script}`);
    previousIndex = scriptIndex;
    assert.ok(fs.existsSync(path.join(repositoryRoot, script)), `fichier script introuvable : ${script}`);
  });

  localScripts.forEach((script) => {
    assert.ok(fs.existsSync(path.join(repositoryRoot, script)), `script local référencé mais absent : ${script}`);
  });
  assert.equal(localScripts.includes("js/ui-reception.js"), false, "l'ancien module ui-reception.js ne doit plus être chargé");
  assert.equal(localScripts.at(-1), "app.js", "app.js doit être le dernier script local chargé");
});

check("initApp ne rappelle pas l'ancienne Réception guidée", () => {
  const initAppSource = extractFunctionSource(appSource, "initApp");
  assert.doesNotMatch(initAppSource, /\binitReceptionWorkspace\s*\(/u, "initApp appelle encore initReceptionWorkspace");
  assert.doesNotMatch(initAppSource, /\brenderReceptionWorkspace\s*\(/u, "initApp appelle encore renderReceptionWorkspace");
});

check("le démarrage ne crée aucun dossier de démonstration", () => {
  const defaultStateSource = extractFunctionSource(stateSource, "createDefaultState");
  assert.match(defaultStateSource, /\bcases\s*:\s*\[\s*\]/u, "createDefaultState doit initialiser cases avec un tableau vide");
  assert.doesNotMatch(defaultStateSource, /\bcases\s*:\s*\[\s*\{/u, "createDefaultState contient encore un dossier préchargé");
  assert.doesNotMatch(defaultStateSource, /Client(?:\s+|["'`,]+\s*)démonstration/iu, "createDefaultState contient encore le client de démonstration");
});

check("tous les assets locaux du service worker existent", () => {
  const assetsBlock = serviceWorkerSource.match(/\bconst\s+ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/u);
  assert.ok(assetsBlock, "la liste ASSETS du service worker est introuvable");
  const assets = [...assetsBlock[1].matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.ok(assets.length > 0, "la liste ASSETS du service worker est vide");
  assert.equal(new Set(assets).size, assets.length, "la liste ASSETS du service worker contient des doublons");

  assets.forEach((asset) => {
    assert.match(asset, /^\.\//u, `asset non local ou mal formé : ${asset}`);
    const relativeAsset = asset.slice(2).split(/[?#]/u, 1)[0];
    const absoluteAsset = path.resolve(repositoryRoot, relativeAsset || ".");
    const relativeToRoot = path.relative(repositoryRoot, absoluteAsset);
    assert.ok(relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot)), `asset hors dépôt : ${asset}`);
    assert.ok(fs.existsSync(absoluteAsset), `asset du service worker introuvable : ${asset}`);
    if (relativeAsset) assert.ok(fs.statSync(absoluteAsset).isFile(), `asset du service worker non fichier : ${asset}`);
  });

  ["./index.html", "./styles.css", "./app.js", "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js"].forEach((asset) => {
    assert.ok(assets.includes(asset), `asset critique absent du service worker : ${asset}`);
  });
});

const failures = checks.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`STATIC STARTUP SAFETY FAIL (${failures.length}/${checks.length})`);
  process.exitCode = 1;
} else {
  console.log(`STATIC STARTUP SAFETY OK (${checks.length}/${checks.length})`);
}
