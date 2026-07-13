import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("app.js", "utf8");

assert.match(
  app,
  /function handleDelegatedWorkHoursChange\(event\)[\s\S]*?event\.target\?\.closest\?\.\("\[data-work-day\]"\)/u,
  "Le gestionnaire délégué doit reconnaître les champs horaires recréés dynamiquement.",
);

assert.match(
  app,
  /document\.addEventListener\("change", handleDelegatedWorkHoursChange\)/u,
  "Le listener horaires doit être attaché à document, qui reste stable après render().",
);

assert.match(
  app,
  /dataset\.workHoursDelegatedBound === "true"/u,
  "Le binding délégué doit être idempotent.",
);

assert.doesNotMatch(
  app,
  /\$\$\("\[data-work-day\]"\)\.forEach\(\(input\) =>/u,
  "Le binding direct fragile sur les champs temporaires doit être supprimé.",
);

assert.match(
  app,
  /markWorkHoursLocallyModified\(state\.workHours,[\s\S]*?saveState\(\{ cloudReason: "work-hours" \}\)/u,
  "La modification doit rester marquée localement avant la sauvegarde cloud.",
);

console.log("WORK HOURS DYNAMIC DOM BINDING V23.3.1 OK");
