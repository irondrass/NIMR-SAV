import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({
  filename: "qc-professional-planning-qcpro001.js",
});

const calendar = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};

const mondayStart = new Date("2026-05-18T08:00:00+01:00");

function resetState(resources, users = [], bookings = []) {
  run(`
    state = normalizeState(${JSON.stringify({
      settings: {
        calendar,
        fastLaneEnabled: false,
      },
      resources,
      users,
      bookings,
      cases: [],
    })});
    generatedProposals = {};
  `);
}

function getStep(proposal, key) {
  return proposal.steps.find((step) => step.key === key);
}

function getStepMinutes(step) {
  if (!step) return 0;

  if (Array.isArray(step.segments) && step.segments.length) {
    return step.segments.reduce((sum, segment) => {
      return sum + Math.round(
        (new Date(segment.end).getTime() - new Date(segment.start).getTime())
        / 60000
      );
    }, 0);
  }

  return Math.round(
    (new Date(step.end).getTime() - new Date(step.start).getTime())
    / 60000
  );
}

const mechanic = {
  id: "mec-1",
  name: "Mécanicien 1",
  role: "mecanicien",
  active: true,
};

const qcResource = {
  id: "qc-resource-1",
  name: "Contrôleur Qualité 1",
  role: "controle",
  active: true,
};

const chiefResource = {
  id: "chief-resource-1",
  name: "Chef Atelier QC",
  role: "controle",
  active: true,
};

const qcUser = {
  id: "qc-user",
  name: "Contrôleur Qualité",
  role: "controle_qualite",
  resourceId: "qc-resource-1",
  active: true,
};

const chiefUser = {
  id: "chief-user",
  name: "Chef Atelier",
  role: "chef_atelier",
  resourceId: "chief-resource-1",
  active: true,
};

test("QC-PRO A1 — une politique professionnelle de durée QC existe", () => {
  assert.equal(
    run(`typeof getProfessionalQualityControlMinutes`),
    "function",
    "getProfessionalQualityControlMinutes doit exister"
  );
});

test("QC-PRO A2 — service rapide simple = 15 minutes de QC", () => {
  assert.equal(
    run(`getProfessionalQualityControlMinutes({
      id: "qc-fast",
      durations: { oilService: 1 }
    })`),
    15
  );
});

test("QC-PRO A3 — réparation mécanique standard = 30 minutes de QC", () => {
  assert.equal(
    run(`getProfessionalQualityControlMinutes({
      id: "qc-mechanical",
      durations: { mechanical: 2 }
    })`),
    30
  );
});

test("QC-PRO A4 — essai routier ajoute 15 minutes", () => {
  assert.equal(
    run(`getProfessionalQualityControlMinutes({
      id: "qc-road",
      durations: { mechanical: 2 },
      qualityControl: {
        roadTestRequired: true
      }
    })`),
    45
  );
});

test("QC-PRO A5 — sécurité critique / HV / comeback plafonne à 60 minutes", () => {
  assert.equal(
    run(`getProfessionalQualityControlMinutes({
      id: "qc-critical",
      durations: { mechanical: 2 },
      qualityControl: {
        roadTestRequired: true,
        criticalSafety: true
      }
    })`),
    60
  );
});

test("QC-PRO B1 — le planning crée automatiquement le QC même si durations.quality est absent", () => {
  resetState(
    [mechanic, qcResource],
    [qcUser]
  );

  const proposal = context.generateSingleProposal(
    {
      id: "case-auto-qc",
      durations: {
        mechanical: 1
      }
    },
    mondayStart
  );

  const mechanical = getStep(proposal, "mechanical");
  const quality = getStep(proposal, "quality");

  assert.ok(mechanical, "la tâche mécanique doit exister");
  assert.ok(quality, "la tâche QC doit être créée automatiquement");
  assert.equal(
    getStepMinutes(quality),
    30,
    "une réparation mécanique standard doit réserver 30 min de QC"
  );

  assert.ok(
    new Date(quality.start) >= new Date(mechanical.end),
    "le QC ne peut pas commencer avant la fin de la réparation"
  );
});

test("QC-PRO B2 — le Contrôleur Qualité est prioritaire sur le Chef Atelier", () => {
  resetState(
    [mechanic, chiefResource, qcResource],
    [chiefUser, qcUser]
  );

  const proposal = context.generateSingleProposal(
    {
      id: "case-qc-priority",
      durations: {
        mechanical: 1
      }
    },
    mondayStart
  );

  const quality = getStep(proposal, "quality");

  assert.ok(quality, "la tâche QC doit exister");

  assert.equal(
    quality.primaryResourceId,
    "qc-resource-1",
    "si un Contrôleur Qualité est disponible, il doit être prioritaire"
  );

  assert.equal(
    quality.qualityAssignmentMode,
    "quality_controller",
    "l'affectation normale doit être explicitement traçable"
  );
});

test("QC-PRO B3 — Chef Atelier uniquement en fallback si aucun QC n'est disponible", () => {
  resetState(
    [
      mechanic,
      {
        ...qcResource,
        active: false,
      },
      chiefResource,
    ],
    [qcUser, chiefUser]
  );

  const proposal = context.generateSingleProposal(
    {
      id: "case-qc-fallback",
      durations: {
        mechanical: 1
      }
    },
    mondayStart
  );

  const quality = getStep(proposal, "quality");

  assert.ok(quality, "la tâche QC doit toujours exister");

  assert.equal(
    quality.primaryResourceId,
    "chief-resource-1",
    "le Chef Atelier doit prendre le QC si aucun contrôleur n'est disponible"
  );

  assert.equal(
    quality.qualityAssignmentMode,
    "chief_fallback",
    "le fallback Chef Atelier doit être explicitement auditable"
  );
});

test("QC-PRO C1 — le rôle Contrôleur Qualité accède au workspace d'exécution", () => {
  const tabs = run(`getAllowedTabsForRole("controle_qualite")`);

  assert.ok(
    Array.from(tabs).includes("technician"),
    "le Contrôleur Qualité doit accéder au workspace d'exécution des tâches QC"
  );
});

test("QC-PRO C2 — le Contrôleur Qualité peut exécuter uniquement sa tâche QC affectée", () => {
  resetState(
    [mechanic, qcResource],
    [qcUser]
  );

  const qualityBooking = {
    id: "booking-qc",
    caseId: "case-qc",
    key: "quality",
    resourceIds: ["qc-resource-1"],
    primaryResourceId: "qc-resource-1",
    qualityAssignmentMode: "quality_controller",
  };

  const mechanicalBooking = {
    id: "booking-mechanical",
    caseId: "case-qc",
    key: "mechanical",
    resourceIds: ["mec-1"],
    primaryResourceId: "mec-1",
  };

  run(`state.currentUserId = "qc-user"`);

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(qualityBooking)}
    )`),
    true,
    "le Contrôleur Qualité doit pouvoir exécuter son QC"
  );

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(mechanicalBooking)}
    )`),
    false,
    "le Contrôleur Qualité ne doit pas exécuter une tâche mécanique"
  );
});

test("QC-PRO C3 — le Chef Atelier ne peut exécuter QC que sur fallback explicite", () => {
  resetState(
    [qcResource, chiefResource],
    [qcUser, chiefUser]
  );

  run(`state.currentUserId = "chief-user"`);

  const normalQc = {
    id: "qc-normal",
    caseId: "case-normal",
    key: "quality",
    resourceIds: ["qc-resource-1"],
    primaryResourceId: "qc-resource-1",
    qualityAssignmentMode: "quality_controller",
  };

  const fallbackQc = {
    id: "qc-fallback",
    caseId: "case-fallback",
    key: "quality",
    resourceIds: ["chief-resource-1"],
    primaryResourceId: "chief-resource-1",
    qualityAssignmentMode: "chief_fallback",
  };

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(normalQc)}
    )`),
    false,
    "le Chef Atelier ne doit pas prendre un QC affecté au contrôleur"
  );

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(fallbackQc)}
    )`),
    true,
    "le Chef Atelier doit pouvoir exécuter un QC explicitement basculé en fallback"
  );
});

test("QC-PRO C4 — réception et technicien standard ne peuvent jamais valider une tâche QC", () => {
  resetState(
    [
      qcResource,
      {
        id: "tech-resource",
        name: "Technicien",
        role: "mecanicien",
        active: true,
      },
    ],
    [
      {
        id: "front-user",
        name: "Réception",
        role: "reception",
        active: true,
      },
      {
        id: "tech-user",
        name: "Technicien",
        role: "technicien",
        resourceId: "tech-resource",
        active: true,
      },
    ]
  );

  const qualityBooking = {
    id: "qc-protected",
    caseId: "case-protected",
    key: "quality",
    resourceIds: ["qc-resource-1"],
    primaryResourceId: "qc-resource-1",
    qualityAssignmentMode: "quality_controller",
  };

  run(`state.currentUserId = "front-user"`);

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(qualityBooking)}
    )`),
    false
  );

  run(`state.currentUserId = "tech-user"`);

  assert.equal(
    run(`canActOnTechnicianTask(
      getCurrentUser(),
      ${JSON.stringify(qualityBooking)}
    )`),
    false
  );
});

console.log("QC-PRO-001 PROFESSIONAL PLANNING CONTRACT COMPLETE");
