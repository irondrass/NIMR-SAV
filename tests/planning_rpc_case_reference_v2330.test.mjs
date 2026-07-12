import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");

const start = source.indexOf("async function reservePlanningProposalAtomically(");
const end = source.indexOf(
  'if (typeof window !== "undefined") window.reservePlanningProposalAtomically',
  start,
);

assert.ok(start >= 0 && end > start, "reservePlanningProposalAtomically doit exister");

const fn = source.slice(start, end);

assert.match(
  fn,
  /const planningCaseReference = caseSyncLocalId\(item\) \|\| item\.orNavNumber \|\| item\.id;/,
  "la réservation doit utiliser la même clé canonique que repair_orders.local_id",
);

assert.match(
  fn,
  /p_case_id:\s*planningCaseReference,/,
  "le RPC doit recevoir le local_id canonique, pas l'identifiant local éphémère du navigateur",
);

assert.doesNotMatch(
  fn,
  /p_case_id:\s*item\.id,/,
  "item.id ne doit plus être envoyé directement au RPC planning",
);

assert.match(
  fn,
  /planning:\$\{getSupabaseWorkshopId\(\)\}:\$\{planningCaseReference\}:/,
  "la clé d'idempotence doit rester stable après restauration ou changement d'identifiant local",
);

assert.match(
  source,
  /function caseSyncLocalId\(item\)[\s\S]*?return `case-or:\$\{orderNumber\}`;/,
  "caseSyncLocalId doit privilégier le numéro OR canonique",
);

console.log("PLANNING RPC CASE REFERENCE V23.3.0 OK");
