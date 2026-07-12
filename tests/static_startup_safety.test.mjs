import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentBuild, getVersionedAssetQueries } from "./helpers/build_version.mjs";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, "..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}(`;
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
const uiCasesSource = readRepositoryFile(path.join("js", "ui-cases.js"));
const estimateImportSource = readRepositoryFile(path.join("js", "estimate-import.js"));
const planningSource = readRepositoryFile(path.join("js", "planning.js"));
const serviceWorkerSource = readRepositoryFile("sw.js");
const versionSource = readRepositoryFile(path.join("js", "version.js"));
const offlineSource = readRepositoryFile("offline.html");

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
    "Contrôle Qualité",
    "En attente de QC",
    "PV restitution",
    "Accord client",
    "Accord expert",
    "Facturation",
    "Paiement",
    "Préparation anticipée",
  ];

  requiredTexts.forEach((text) => {
    assert.ok(indexSource.includes(text), `texte PDF-first manquant : « ${text} »`);
  });
  forbiddenTexts.forEach((text) => {
    assert.equal(indexSource.includes(text), false, `ancien texte encore présent : « ${text} »`);
  });
  assert.doesNotMatch(indexSource, /data-tab=["']qc-workspace["']/u);
  assert.doesNotMatch(indexSource, /data-case-panel=["']livraison["']/u);
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

check("les statuts et actions actifs sont canoniques, sans porte QC", () => {
  const getCaseStatusSource = extractFunctionSource(stateSource, "getCaseStatus");
  assert.match(getCaseStatusSource, /"chief_validation"/u);
  assert.match(getCaseStatusSource, /"completed"/u);
  assert.match(getCaseStatusSource, /"closed"/u);
  assert.match(getCaseStatusSource, /"archived"/u);
  assert.doesNotMatch(getCaseStatusSource, /return\s+"(?:receptionDraft|approvals|quality|delivered|invoiced)"/u);
  assert.doesNotMatch(uiCasesSource, /function\s+renderQcWorkspace\b/u, "l'ancien workspace QC doit être supprimé du module actif");
  assert.doesNotMatch(planningSource, /quality_pending|Contrôle qualité à faire/u, "aucune porte QC ne doit rester dans le flux technicien");
  assert.match(indexSource, /data-action-flag=["']close["']/u, "l'action clôture atelier doit être visible");
  assert.match(indexSource, /data-action-flag=["']archive["']/u, "l'action archive distincte doit être visible");
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

  [
    "./index.html",
    `./styles.css?v=${currentBuild.queryVersion}`,
    `./app.js?v=${currentBuild.queryVersion}`,
    `./vendor/pdf.min.js?v=${currentBuild.queryVersion}`,
    `./vendor/pdf.worker.min.js?v=${currentBuild.queryVersion}`,
  ].forEach((asset) => {
    assert.ok(assets.includes(asset), `asset critique absent du service worker : ${asset}`);
  });
});

check("le contrat build et le précache PWA utilisent les mêmes URLs exactes", () => {
  assert.equal(currentBuild.buildVersion, currentBuild.appVersion, "NIMR_BUILD doit être identique à APP_VERSION");
  assert.equal(currentBuild.cacheName, `nimr-sav-${currentBuild.appVersion}`, "le cache doit être dérivé du build courant");
  assert.ok(versionSource.includes(`window.APP_VERSION = "${currentBuild.appVersion}"`));
  assert.doesNotMatch(versionSource, /caches\.delete/u, "version.js ne doit pas supprimer le cache actif avant l'activation du nouveau service worker");
  assert.ok(stateSource.includes(`const APP_VERSION = "${currentBuild.appVersion}"`));
  assert.ok(serviceWorkerSource.includes(`const CACHE_NAME = "${currentBuild.cacheName}"`));
  assert.doesNotMatch(serviceWorkerSource, /cache\.add\([^)]*\)\.catch/u, "l'installation PWA doit échouer plutôt qu'activer un précache partiel");
  assert.ok(appSource.includes(`serviceWorker.register("sw.js?v=${currentBuild.queryVersion}"`));

  const assetsBlock = serviceWorkerSource.match(/\bconst\s+ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/u);
  assert.ok(assetsBlock, "la liste ASSETS du service worker est introuvable");
  const cachedAssets = new Set([...assetsBlock[1].matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]));
  const indexVersionedAssets = [
    ...indexSource.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\?v=[^"']+)["'][^>]*>/giu),
  ]
    .map((match) => match[1])
    .filter((asset) => !/^(?:https?:)?\/\//iu.test(asset))
    .map((asset) => `./${asset.replace(/^\.\//u, "")}`);
  indexVersionedAssets.forEach((asset) => {
    assert.ok(cachedAssets.has(asset), `l'URL exacte chargée par index.html n'est pas précachée : ${asset}`);
  });

  const workerSources = [...`${appSource}\n${estimateImportSource}`.matchAll(/GlobalWorkerOptions\.workerSrc\s*=\s*["']([^"']+)["']/gu)]
    .map((match) => match[1]);
  assert.ok(workerSources.length >= 2, "les chemins principal et fallback du worker PDF doivent être déclarés");
  workerSources.forEach((workerSource) => {
    assert.equal(workerSource, `vendor/pdf.worker.min.js?v=${currentBuild.queryVersion}`, "le worker PDF doit être versionné");
    assert.ok(cachedAssets.has(`./${workerSource}`), "l'URL exacte du worker PDF doit être précachée");
  });
  assert.match(offlineSource, new RegExp(`styles\\.css\\?v=${currentBuild.queryVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`), "offline.html doit utiliser le CSS courant");
  getVersionedAssetQueries(`${indexSource}\n${offlineSource}\n${appSource}\n${estimateImportSource}`).forEach((queryVersion) => {
    assert.equal(queryVersion, currentBuild.queryVersion, `query d'asset active incohérente : ${queryVersion}`);
  });
});

const failures = checks.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`STATIC STARTUP SAFETY FAIL (${failures.length}/${checks.length})`);
  process.exitCode = 1;
} else {
  console.log(`STATIC STARTUP SAFETY OK (${checks.length}/${checks.length})`);
}
