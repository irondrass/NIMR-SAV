import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function readWindowAssignment(source, name) {
  const match = source.match(new RegExp(`window\\.${name}\\s*=\\s*["']([^"']+)["']`, "u"));
  if (!match?.[1]) throw new Error(`${name} est introuvable dans js/version.js`);
  return match[1];
}

export function readCurrentBuildContract(root = repositoryRoot) {
  const versionSource = fs.readFileSync(path.join(root, "js", "version.js"), "utf8");
  const appVersion = readWindowAssignment(versionSource, "APP_VERSION");
  const buildVersion = readWindowAssignment(versionSource, "NIMR_BUILD");
  const cacheName = readWindowAssignment(versionSource, "NIMR_CACHE_NAME");
  const queryVersion = appVersion.replace(/^v/u, "");
  if (!queryVersion) throw new Error("APP_VERSION ne permet pas de dériver la query d'assets");
  return Object.freeze({
    appVersion,
    buildVersion,
    cacheName,
    queryVersion,
    versionSource,
  });
}

export const currentBuild = readCurrentBuildContract();

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function getVersionedAssetQueries(source) {
  return [...String(source || "").matchAll(/[?&]v=([^"'&<>\s]+)/gu)].map((match) => match[1]);
}
