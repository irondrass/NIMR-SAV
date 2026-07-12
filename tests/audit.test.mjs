import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptFiles = [
  '../js/state.js',
  '../js/ui-cases.js',
  '../js/estimate-import.js',
  '../js/ui-planning.js',
  '../js/photos.js',
  '../js/storage.js',
  '../js/planning.js',
  '../js/exports.js',
  '../js/utils.js',
  '../app.js',
];

const appSource = scriptFiles
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/initApp\(\);/, '// initApp skipped by tests')
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, '');

function createElementStub() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    prepend() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    closest: () => createElementStub(),
  };
}

const context = {
  console: {
    log: () => {}, // silence normal logs
    warn: () => {},
    error: console.error,
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: { addEventListener: () => {} },
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  FormData: class FormData {},
};

vm.createContext(context);
vm.runInContext(appSource, context, { filename: 'app.js' });

console.log("Démarrage de l'audit QA (5 dossiers)...");

let passed = 0;
let failed = 0;
const anomalies = [];

function audit(name, scenarioFn) {
  try {
    scenarioFn();
    passed++;
  } catch (err) {
    failed++;
    anomalies.push({ name, error: err.message });
  }
}

audit("La configuration Supabase publiée ne doit pas contenir de clé projet codée en dur", () => {
  const configSource = fs.readFileSync(new URL('../js/supabase-config.js', import.meta.url), 'utf8');
  assert.equal(configSource.includes('lkbdllixvkmywxcksiuj.supabase.co'), false, 'URL Supabase réelle exposée dans js/supabase-config.js');
  assert.equal(/eyJhbGciOiJIUzI1Ni/i.test(configSource), false, 'JWT anon codé en dur dans js/supabase-config.js');
  assert.ok(configSource.includes('SUPABASE_RUNTIME_CONFIG_KEY'), 'la config runtime locale doit exister');
});

audit("index.html doit définir une politique CSP compatible PWA", () => {
  const htmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(htmlSource.includes('Content-Security-Policy'), 'CSP absente de index.html');
  assert.ok(htmlSource.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co"), 'CSP Supabase/Reatime incomplète');
  assert.ok(htmlSource.includes("object-src 'none'"), 'CSP doit interdire les contenus object/embed');
});

audit("Le schéma Supabase doit isoler les données par atelier", () => {
  const schema = fs.readFileSync(new URL('../supabase-schema.sql', import.meta.url), 'utf8');
  assert.ok(schema.includes('public.workshops'), 'table workshops manquante');
  assert.ok(schema.includes('public.workshop_members'), 'table workshop_members manquante');
  assert.ok(schema.includes('public.is_workshop_member(workshop_id)'), 'politiques RLS par workshop_id manquantes');
  assert.equal(/using\s*\(\s*true\s*\)/i.test(schema), false, 'politique RLS permissive using(true) détectée');
  assert.equal(/with check\s*\(\s*true\s*\)/i.test(schema), false, 'politique RLS permissive with check(true) détectée');
});

// Helper pour instancier un état de base vierge avec toutes les ressources actives
vm.runInContext(`
  function createAuditState() {
    state = normalizeState({
      users: [{ id: 'audit-chief', name: 'Chef audit', role: 'chef_atelier', active: true }],
      currentUserId: 'audit-chief',
      cases: [],
      resources: [
        { id: 't1', name: 'Tôlier', role: 'tolier', active: true },
        { id: 'm1', name: 'Mécanicien', role: 'mecanicien', active: true },
        { id: 'e1', name: 'Electricien', role: 'electricien', active: true },
        { id: 'p1', name: 'Peintre', role: 'peintre', active: true },
        { id: 'z1', name: 'Zone prep', role: 'zone_preparation', active: true },
        { id: 'c1', name: 'Cabine', role: 'cabine', active: true },
        { id: 'qc', name: 'Qualité', role: 'controle', active: true },
        { id: 'pont1', name: 'Pont', role: 'pont_mecanique', active: true },
        { id: 'pont2', name: 'Pont Vid', role: 'pont_vidange', active: true },
      ],
      bookings: []
    });
  }
  createAuditState();
`, context);

// ==========================================
// GÉNÉRATION ET AUDIT DE 100+ SCÉNARIOS
// ==========================================

// SCÉNARIO 1 : Le workflow atelier simplifié ne réactive pas l'accord expert
audit("Le RDV atelier simplifié ne doit pas dépendre de l'accord expert", () => {
  const dossier = context.normalizeCase({
    id: "case-rdv-no-approvals",
    clientName: "Client RDV",
    plate: "123 TU 456",
    insurance: "Assurance",
    photos: [{ id: 'p1', category: 'before' }],
    claims: [{
      type: "assurance",
      includeInPlanning: true,
      expertApproved: false,
      clientApproved: false,
      estimate: { lines: [{ phase: "body", laborHours: 2 }] }
    }]
  });
  
  const warnings = context.getBusinessRuleWarnings(dossier, "appointment");
  assert.equal(warnings.some(i => i.includes("Accord expert manquant")), false, "Le P0 ne doit pas réactiver l'accord expert dans le planning atelier.");
});

// SCÉNARIO 2 : Réception sans dossier complet
audit("Une réception ne doit pas être possible sans dossier complet (RDV fixé)", () => {
  const dossier = context.normalizeCase({
    id: "case-reception-no-rdv",
    clientName: "Client Reception",
    appointment: null
  });
  
  const warnings = context.getBusinessRuleWarnings(dossier, "received");
  assert.ok(
    warnings.some(i => i.includes("Ce véhicule est réceptionné sans rendez-vous")),
    "Devrait avertir de la réception exceptionnelle si aucun RDV n'a été fixé."
  );
});

// SCÉNARIO 3 : les anciennes portes QC/livraison restent inactives
audit("Les anciennes portes QC et livraison ne déterminent plus le flux", () => {
  const dossier = context.normalizeCase({
    id: "case-delivery-no-qc",
    appointment: { start: "2026-05-18T08:00:00" },
    flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false }
  });
  // Simulate assignments
  vm.runInContext(`state.bookings.push({ caseId: 'case-delivery-no-qc', resourceIds: ['t1'] })`, context);

  const issues = context.getBusinessRuleIssues(dossier, "delivered");
  assert.equal(issues.some(i => /contrôle qualité|livraison/i.test(i)), false, "Les anciennes portes QC/livraison doivent rester inactives.");
});

// SCÉNARIO 4 : La clôture atelier simplifiée ne réactive pas livraison/facturation
audit("La clôture atelier ne doit pas réactiver la livraison ou la facturation", () => {
  const dossier = context.normalizeCase({
    id: "case-invoice-no-delivery",
    flags: { delivered: false }
  });
  const issues = context.getBusinessRuleIssues(dossier, "close");
  assert.equal(issues.some(i => i.includes("Livrer le véhicule avant de facturer")), false, "Le P0 ne doit pas réactiver livraison/facturation.");
});

// SCÉNARIO 5 : clôture sans photo obligatoire
audit("La clôture assurance n'exige pas de photo après réparation", () => {
  const dossier = context.normalizeCase({
    id: "case-delivery-no-after-photo",
    appointment: { start: "2026-05-18T08:00:00" },
    flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true },
    photos: [{ id: "p1", category: "before" }],
    claims: [{
      type: "assurance",
      includeInPlanning: true,
      estimate: { lines: [{ phase: "body", laborHours: 2 }] }
    }]
  });
  vm.runInContext(`state.bookings.push({ caseId: 'case-delivery-no-after-photo', resourceIds: ['t1'] })`, context);

  const issues = context.getBusinessRuleIssues(dossier, "close");
  assert.equal(issues.some(i => /photo|livraison|qualité/i.test(i)), false, "La clôture ne doit pas dépendre d'une photo, livraison ou étape qualité.");
});

// SCÉNARIO 6 : Création massive de dossiers et progression logique (100 dossiers)
audit("Progression logique de 5 dossiers dans tous les états possibles", () => {
  for (let i = 0; i < 5; i++) {
    const isClient = i % 2 === 0;
    const hasExpert = !isClient && i % 3 === 0;
    
    // On part d'un dossier brouillon
    const dossier = context.normalizeCase({
      id: `case-mass-${i}`,
      clientName: `Mass Client ${i}`,
      plate: `100 TU ${i}`,
      insurance: isClient ? "" : "GAT",
      expertName: hasExpert ? "Expert" : "",
      claims: [{
        type: isClient ? "client" : "assurance",
        includeInPlanning: true,
        expertApproved: false,
        clientApproved: false,
        estimate: { lines: [{ phase: "body", laborHours: 2 }] }
      }]
    });

    // 1. RDV atelier direct, sans réactiver accords expert/client.
    assert.equal(context.getNextWorkflowAction(dossier), "appointment", "L'action suivante doit être le RDV");
    const issuesRdv = context.getBusinessRuleIssues(dossier, "appointment");
    assert.equal(issuesRdv.length, 0, "Le RDV atelier direct devrait être possible");
    const warningsRdv = context.getBusinessRuleWarnings(dossier, "appointment");
    assert.equal(warningsRdv.some((warning) => /expert|client\/interne/i.test(warning)), false, "Le P0 ne doit pas réactiver les accords expert/client");
    dossier.appointment = { start: "2026-05-18T08:00:00" };
    // Le RDV n'est pas une "action" via applyWorkflowAction mais un champ. 
    // L'UI fixe le RDV puis recharge.

    // 5. Réception
    assert.equal(context.getNextWorkflowAction(dossier), "received", "L'action suivante doit être la réception");
    context.applyWorkflowAction(dossier, "received");

    // 6. Travaux
    vm.runInContext(`state.bookings.push({
      id: 'booking-mass-${i}',
      caseId: 'case-mass-${i}',
      key: 'body',
      title: 'Tôlerie',
      resourceIds: ['t1'],
      primaryResourceId: 't1',
      segments: [{ start: '2026-05-18T08:00:00.000Z', end: '2026-05-18T09:00:00.000Z' }],
      start: '2026-05-18T08:00:00.000Z',
      end: '2026-05-18T09:00:00.000Z',
      plannedStart: '2026-05-18T08:00:00.000Z',
      plannedEnd: '2026-05-18T09:00:00.000Z',
      plannedMinutes: 60
    })`, context);
    assert.equal(context.getNextWorkflowAction(dossier), "workStarted", "L'action suivante doit être le démarrage");
    context.applyWorkflowAction(dossier, "workStarted");

    assert.equal(context.getNextWorkflowAction(dossier), "workCompleted", "L'action suivante doit être la fin");
    context.completeCaseWorkBookingsNow(dossier, new Date("2026-05-18T09:00:00"), {
      completedByOverride: "audit",
      actorLabel: "Audit test",
      overrideReason: "Progression logique audit",
      keepEmptyBookings: true,
    });

    // 7. Clôture puis archive, sans réactiver QC/livraison/facturation dans l'UI.
    assert.equal(context.getNextWorkflowAction(dossier), "close", "L'action suivante doit être la clôture atelier simplifiée");
    context.applyWorkflowAction(dossier, "close");
    assert.equal(context.getNextWorkflowAction(dossier), "archive", "L'archive doit suivre la clôture atelier");
    context.applyWorkflowAction(dossier, "archive");

    // FIN
    assert.equal(context.getNextWorkflowAction(dossier), null, "Un dossier archivé n'a plus d'action suivante");
  }
});

// SCÉNARIO 8 : aucune préparation automatique hors séquence
audit("Le planning ne crée aucune préparation anticipée automatique", () => {
  vm.runInContext(`createAuditState();`, context);
  const dossier = context.normalizeCase({
    id: "case-new-parts-planning",
    clientName: "Client Pièces Neuves",
    plate: "999 TU 2026",
    durations: { body: 4, prep: 3, paint: 2, reassembly: 2, finish: 0.5, quality: 0.25 },
    claims: [{
      id: "claim-new-part",
      type: "client",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      estimate: {
        originalLines: [{
          id: "line-pc-av",
          operation: "PREPARATION ET PEINTURE NOUVEAU PARECHOC",
          laborHours: 3,
          pieceKind: "new",
          allocations: [
            { phase: "prep", laborHours: 1 },
            { phase: "paint", laborHours: 1 }
          ]
        }, {
          id: "line-porte-avd",
          operation: "DRESSAGE ET PEINTURE PORTE AVANT DROIT",
          laborHours: 4,
          pieceKind: "repair",
          allocations: [
            { phase: "body", laborHours: 4 },
            { phase: "prep", laborHours: 2 },
            { phase: "paint", laborHours: 1 }
          ]
        }],
        lines: [
          { phase: "body", laborHours: 4 },
          { phase: "prep", laborHours: 3 },
          { phase: "paint", laborHours: 2 },
          { phase: "reassembly", laborHours: 2 },
          { phase: "finish", laborHours: 0.5 },
          { phase: "quality", laborHours: 0.25 }
        ]
      }
    }]
  });
  const proposal = context.schedulePipeline(dossier, new Date("2026-05-18T08:00:00"), []);
  const anticipated = proposal.steps.filter((step) => step.planningMode === "anticipated-new-part");
  assert.equal(anticipated.length, 0, "Aucune étape anticipée automatique ne doit être créée.");
  const body = proposal.steps.find((step) => step.key === "body");
  const normalPrep = proposal.steps.find((step) => step.key === "prep");
  const paint = proposal.steps.find((step) => step.key === "paint");
  const reassembly = proposal.steps.find((step) => step.key === "reassembly");
  assert.ok(new Date(normalPrep.start) >= new Date(body.end), "La préparation de la pièce réparée attend la fin de la tôlerie.");
  assert.ok(new Date(paint.start) >= new Date(normalPrep.end), "La peinture groupée démarre après les préparations.");
  assert.ok(new Date(reassembly.start) >= new Date(paint.end), "Le remontage attend la peinture groupée.");
});

// SCÉNARIO 9 : Sans zone ou peintre libre au démarrage, retour au flux normal
audit("Le planning garde le flux normal si la zone ou le peintre ne sont pas libres", () => {
  vm.runInContext(`createAuditState();`, context);
  const dossier = context.normalizeCase({
    id: "case-new-parts-no-capacity",
    clientName: "Client Sans Capacité",
    plate: "777 TU 2026",
    durations: { body: 2, prep: 2, paint: 1, reassembly: 1, quality: 0.25 },
    claims: [{
      id: "claim-new-part-busy",
      type: "client",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      estimate: {
        originalLines: [{
          id: "line-pc-busy",
          operation: "PREPARATION ET PEINTURE NOUVEAU PARECHOC",
          pieceKind: "new",
          allocations: [
            { phase: "prep", laborHours: 1 },
            { phase: "paint", laborHours: 1 }
          ]
        }],
        lines: [
          { phase: "body", laborHours: 2 },
          { phase: "prep", laborHours: 2 },
          { phase: "paint", laborHours: 1 },
          { phase: "reassembly", laborHours: 1 },
          { phase: "quality", laborHours: 0.25 }
        ]
      }
    }]
  });
  const busy = [{
    id: "busy-prep-zone",
    caseId: "other-case",
    title: "Occupation zone préparation",
    key: "prep",
    start: "2026-05-18T08:00:00.000Z",
    end: "2026-05-18T10:00:00.000Z",
    resourceIds: ["p1", "z1"],
    segments: [{ start: "2026-05-18T08:00:00.000Z", end: "2026-05-18T10:00:00.000Z" }]
  }];
  const proposal = context.schedulePipeline(dossier, new Date("2026-05-18T08:00:00"), busy);
  assert.equal(proposal.steps.some((step) => step.planningMode === "anticipated-new-part"), false, "Aucune anticipation ne doit être créée sans capacité libre au démarrage.");
  const body = proposal.steps.find((step) => step.key === "body");
  const prep = proposal.steps.find((step) => step.key === "prep");
  assert.ok(new Date(prep.start) >= new Date(body.end), "La préparation suit le flux normal après la tôlerie.");
});

// SCÉNARIO 10 : Les pièces à réparer restent dans le flux véhicule normal
audit("Une pièce à réparer ne déclenche pas de préparation anticipée", () => {
  vm.runInContext(`createAuditState();`, context);
  const dossier = context.normalizeCase({
    id: "case-repair-piece-planning",
    clientName: "Client Pièce Réparée",
    plate: "888 TU 2026",
    durations: { body: 2, prep: 2, paint: 1, reassembly: 1, quality: 0.25 },
    claims: [{
      id: "claim-repair-part",
      type: "client",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      estimate: {
        originalLines: [{
          id: "line-repair",
          operation: "DRESSAGE ET PEINTURE AILE AV DR",
          laborHours: 3,
          pieceKind: "repair",
          allocations: [
            { phase: "prep", laborHours: 2 },
            { phase: "paint", laborHours: 1 }
          ]
        }],
        lines: [
          { phase: "body", laborHours: 2 },
          { phase: "prep", laborHours: 2 },
          { phase: "paint", laborHours: 1 },
          { phase: "reassembly", laborHours: 1 },
          { phase: "quality", laborHours: 0.25 }
        ]
      }
    }]
  });
  const proposal = context.schedulePipeline(dossier, new Date("2026-05-18T08:00:00"), []);
  assert.equal(proposal.steps.some((step) => step.planningMode === "anticipated-new-part"), false, "La pièce à réparer doit suivre le flux véhicule normal.");
});

// ==========================================
// RÉSULTATS
// ==========================================

console.log(`\nAudit terminé.`);
console.log(`✅ Succès: ${passed}`);
console.log(`❌ Échecs: ${failed}`);

if (failed > 0) {
  console.log("\n--- ANOMALIES DÉTECTÉES ---");
  anomalies.forEach((a, index) => {
    console.log(`\n${index + 1}. ${a.name}`);
    console.log(`   Erreur: ${a.error}`);
  });
  process.exit(1);
} else {
  console.log("\nAucune anomalie bloquante détectée !");
  process.exit(0);
}
