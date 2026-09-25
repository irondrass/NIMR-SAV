import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { run } = createNimrVmContext({
  filename: "qc-professional-checklist-qcpro001.js",
});

const uiSource = fs.readFileSync(
  new URL("../js/ui-reception.js", import.meta.url),
  "utf8"
);

const exportSource = fs.readFileSync(
  new URL("../js/exports.js", import.meta.url),
  "utf8"
);

function definition(item) {
  return JSON.parse(
    run(`JSON.stringify(
      getProfessionalQualityChecklistDefinition(${JSON.stringify(item)})
    )`)
  );
}

function pointIds(sections) {
  return sections.flatMap((section) =>
    (section.points || []).map((point) => point.id)
  );
}

function sectionIds(sections) {
  return sections.map((section) => section.id);
}

test("QC-PRO D1 — une définition professionnelle dynamique existe", () => {
  assert.equal(
    run(`typeof getProfessionalQualityChecklistDefinition`),
    "function"
  );
});

test("QC-PRO D2 — toutes les fiches contiennent le socle documentaire et sécurité", () => {
  const sections = definition({
    id: "qc-base",
    durations: { oilService: 1 },
  });

  const ids = sectionIds(sections);

  assert.ok(ids.includes("documentary"));
  assert.ok(ids.includes("general_safety"));
  assert.ok(ids.includes("delivery_preparation"));
});

test("QC-PRO D3 — une vidange charge uniquement les contrôles service rapide pertinents", () => {
  const sections = definition({
    id: "qc-service",
    durations: {
      oilService: 1,
      mechanical: 0,
      electrical: 0,
      body: 0,
      prep: 0,
      paint: 0,
      reassembly: 0,
      finish: 0,
    },
  });

  const sectionsList = sectionIds(sections);
  const points = pointIds(sections);

  assert.ok(sectionsList.includes("quick_service"));
  assert.ok(!sectionsList.includes("body_paint"));
  assert.ok(!sectionsList.includes("electrical_diagnostic"));

  assert.ok(points.includes("service.oil_level"));
  assert.ok(points.includes("service.no_leak"));
  assert.ok(points.includes("service.maintenance_reset"));
});

test("QC-PRO D4 — une réparation mécanique charge la section mécanique", () => {
  const sections = definition({
    id: "qc-mechanical",
    durations: { mechanical: 2 },
  });

  const points = pointIds(sections);

  assert.ok(sectionIds(sections).includes("mechanical"));
  assert.ok(points.includes("mechanical.repair_function"));
  assert.ok(points.includes("mechanical.fasteners"));
  assert.ok(points.includes("mechanical.no_leak"));
});

test("QC-PRO D5 — une intervention électrique charge diagnostic et fonctionnement", () => {
  const sections = definition({
    id: "qc-electrical",
    durations: { electrical: 2 },
  });

  const points = pointIds(sections);

  assert.ok(sectionIds(sections).includes("electrical_diagnostic"));
  assert.ok(points.includes("electrical.final_scan"));
  assert.ok(points.includes("electrical.no_relevant_dtc"));
  assert.ok(points.includes("electrical.repaired_function"));
});

test("QC-PRO D6 — carrosserie / peinture impose les contrôles de finition et la photo finale", () => {
  const sections = definition({
    id: "qc-body",
    durations: {
      body: 2,
      prep: 1,
      paint: 2,
      reassembly: 1,
    },
  });

  const bodySection = sections.find(
    (section) => section.id === "body_paint"
  );

  assert.ok(bodySection);

  const points = bodySection.points || [];
  const ids = points.map((point) => point.id);

  assert.ok(ids.includes("body.panel_alignment"));
  assert.ok(ids.includes("body.paint_finish"));
  assert.ok(ids.includes("body.reassembly"));
  assert.ok(ids.includes("body.final_photo"));

  const photoPoint = points.find(
    (point) => point.id === "body.final_photo"
  );

  assert.equal(
    photoPoint.evidence,
    "photo",
    "la photo finale carrosserie doit être explicitement requise"
  );
});

test("QC-PRO D7 — HEV/EV ajoute une section haute tension dédiée", () => {
  const sections = definition({
    id: "qc-hv",
    durations: { electrical: 2 },
    qualityControl: {
      highVoltage: true,
    },
  });

  const points = pointIds(sections);

  assert.ok(sectionIds(sections).includes("ev_hev"));
  assert.ok(points.includes("hv.no_relevant_fault"));
  assert.ok(points.includes("hv.protection_connectors"));
  assert.ok(points.includes("hv.function_verified"));
});

test("QC-PRO D8 — essai routier requis ajoute une section dynamique structurée", () => {
  const sections = definition({
    id: "qc-road",
    durations: { mechanical: 2 },
    qualityControl: {
      roadTestRequired: true,
    },
  });

  const points = pointIds(sections);

  assert.ok(sectionIds(sections).includes("road_test"));
  assert.ok(points.includes("road.complaint_resolved"));
  assert.ok(points.includes("road.no_abnormal_noise_vibration"));
  assert.ok(points.includes("road.mileage_recorded"));
});

test("QC-PRO D9 — chaque point possède un identifiant stable et unique", () => {
  const sections = definition({
    id: "qc-complete",
    durations: {
      oilService: 1,
      mechanical: 2,
      electrical: 2,
      body: 2,
      prep: 1,
      paint: 2,
      reassembly: 1,
      finish: 1,
    },
    qualityControl: {
      roadTestRequired: true,
      highVoltage: true,
      criticalSafety: true,
    },
  });

  const ids = pointIds(sections);

  assert.ok(ids.length >= 20, "la fiche complète doit être substantielle");
  assert.equal(
    new Set(ids).size,
    ids.length,
    "aucun identifiant de contrôle ne doit être dupliqué"
  );

  for (const section of sections) {
    assert.ok(section.id);
    assert.ok(section.label);

    for (const point of section.points || []) {
      assert.ok(point.id);
      assert.ok(point.label);
      assert.equal(
        typeof point.critical,
        "boolean",
        `${point.id} doit déclarer explicitement sa criticité`
      );
    }
  }
});

test("QC-PRO D10 — la normalisation conserve réellement OK / N/A / NOK", () => {
  const normalized = JSON.parse(
    run(`JSON.stringify(normalizeQualityChecklist({
      "general.no_warning_lights": "ok",
      "general.no_leak": "na",
      "general.reassembly_secure": "nok"
    }, {
      id: "qc-tristate",
      durations: { mechanical: 1 }
    }))`)
  );

  assert.equal(normalized["general.no_warning_lights"], "ok");
  assert.equal(normalized["general.no_leak"], "na");
  assert.equal(normalized["general.reassembly_secure"], "nok");
});

test("QC-PRO D11 — compatibilité historique : true devient OK, false reste à contrôler", () => {
  const normalized = JSON.parse(
    run(`JSON.stringify(normalizeQualityChecklist({
      "Alignement carrosserie": true,
      "Teinte et vernis": false
    }, {
      id: "qc-legacy",
      durations: {
        body: 1,
        paint: 1
      }
    }))`)
  );

  assert.equal(normalized["body.panel_alignment"], "ok");

  assert.equal(
    normalized["body.paint_finish"],
    "",
    "un ancien false signifiait non contrôlé, pas NOK"
  );
});

test("QC-PRO D12 — la checklist vide est générée selon le dossier, pas depuis 5 lignes fixes", () => {
  const checklist = JSON.parse(
    run(`JSON.stringify(createEmptyQualityChecklist({
      id: "qc-empty",
      durations: {
        mechanical: 1,
        electrical: 1
      }
    }))`)
  );

  assert.ok(
    Object.prototype.hasOwnProperty.call(
      checklist,
      "mechanical.repair_function"
    )
  );

  assert.ok(
    Object.prototype.hasOwnProperty.call(
      checklist,
      "electrical.final_scan"
    )
  );

  assert.ok(
    !Object.prototype.hasOwnProperty.call(
      checklist,
      "Alignement carrosserie"
    )
  );

  assert.ok(
    Object.values(checklist).every((value) => value === "")
  );
});

test("QC-PRO D13 — l'écran QC utilise la définition dynamique unique", () => {
  assert.match(
    uiSource,
    /getProfessionalQualityChecklistDefinition\s*\(\s*item\s*\)/u,
    "l'écran QC doit consommer la définition professionnelle du dossier"
  );

  assert.doesNotMatch(
    uiSource,
    /const checks\s*=\s*\[\s*\[\s*["']Alignement carrosserie/u,
    "l'écran ne doit plus posséder sa propre checklist carrosserie codée en dur"
  );
});

test("QC-PRO D14 — le PDF utilise exactement la même définition que l'écran", () => {
  assert.match(
    exportSource,
    /getProfessionalQualityChecklistDefinition\s*\(\s*item\s*\)/u,
    "le PDF doit consommer la même définition dynamique"
  );
});

console.log(
  "QC-PRO-001 PROFESSIONAL DYNAMIC CHECKLIST CONTRACT COMPLETE"
);
