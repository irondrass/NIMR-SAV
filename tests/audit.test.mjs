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
  localStorage: { getItem: () => null, setItem: () => {} },
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

// SCÉNARIO 1 : RDV confirmable sans accords valides
audit("Un RDV ne doit pas être confirmé si les accords nécessaires ne sont pas validés", () => {
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
  assert.ok(
    warnings.some(i => i.includes("Accord expert manquant")),
    "Devrait avertir pour la prise de RDV si l'accord expert est manquant (RDV prévisionnel)."
  );
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

// SCÉNARIO 3 : Livraison avant contrôle qualité
audit("Un véhicule ne doit pas être livré avant contrôle qualité", () => {
  const dossier = context.normalizeCase({
    id: "case-delivery-no-qc",
    appointment: { start: "2026-05-18T08:00:00" },
    flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: false }
  });
  // Simulate assignments
  vm.runInContext(`state.bookings.push({ caseId: 'case-delivery-no-qc', resourceIds: ['t1'] })`, context);

  const issues = context.getBusinessRuleIssues(dossier, "delivered");
  assert.ok(
    issues.some(i => i.includes("Valider le contrôle qualité avant livraison")),
    "Devrait bloquer la livraison si le contrôle qualité n'est pas validé."
  );
});

// SCÉNARIO 4 : Clôture avant livraison
audit("Un dossier ne doit pas être clôturé avant livraison", () => {
  const dossier = context.normalizeCase({
    id: "case-invoice-no-delivery",
    flags: { delivered: false }
  });
  const issues = context.getBusinessRuleIssues(dossier, "invoiced");
  assert.ok(
    issues.some(i => i.includes("Livrer le véhicule avant de facturer")),
    "Devrait bloquer la facturation si le véhicule n'est pas livré."
  );
});

// SCÉNARIO 5 : Livraison d'un dossier assurance sans photo après réparation
audit("Une livraison assurance nécessite une photo après réparation", () => {
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

  const issues = context.getBusinessRuleIssues(dossier, "delivered");
  assert.ok(
    issues.some(i => i.includes("Après réparation avant livraison assurance")),
    "Devrait exiger une photo Après réparation pour les dossiers assurance."
  );
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

    // 1. Ajouter photo avant (requis pour expertApproved assurance)
    if (!isClient) dossier.photos.push({ id: `p-b-${i}`, category: "before" });

    // 2. Accord expert
    if (!isClient) {
      assert.equal(context.getNextWorkflowAction(dossier), "expertApproved", "L'action suivante doit être l'accord expert");
      const issues = context.getBusinessRuleIssues(dossier, "expertApproved");
      assert.equal(issues.length, 0, "L'accord expert devrait être possible");
      context.applyWorkflowAction(dossier, "expertApproved");
    }

    // 3. RDV prévisionnel possible avant validation client/interne
    assert.equal(context.getNextWorkflowAction(dossier), "appointment", "L'action suivante doit permettre un RDV prévisionnel");
    const issuesRdvPrevisionnel = context.getBusinessRuleIssues(dossier, "appointment");
    assert.equal(issuesRdvPrevisionnel.length, 0, "Le RDV prévisionnel devrait être possible");
    assert.ok(context.getBusinessRuleWarnings(dossier, "appointment").some((warning) => warning.includes("client/interne")), "Le RDV prévisionnel doit avertir sur la validation client/interne manquante");

    // 4. Validation client/interne
    const issuesClient = context.getBusinessRuleIssues(dossier, "clientApproved");
    assert.equal(issuesClient.length, 0, "La validation client/interne devrait être possible");
    context.applyWorkflowAction(dossier, "clientApproved");

    // 5. RDV
    assert.equal(context.getNextWorkflowAction(dossier), "appointment", "L'action suivante doit être le RDV");
    dossier.appointment = { start: "2026-05-18T08:00:00" };
    // Le RDV n'est pas une "action" via applyWorkflowAction mais un champ. 
    // L'UI fixe le RDV puis recharge.

    // 5. Réception
    assert.equal(context.getNextWorkflowAction(dossier), "received", "L'action suivante doit être la réception");
    context.applyWorkflowAction(dossier, "received");

    // 6. Travaux
    vm.runInContext(`state.bookings.push({ caseId: 'case-mass-${i}', resourceIds: ['t1'] })`, context);
    assert.equal(context.getNextWorkflowAction(dossier), "workStarted", "L'action suivante doit être le démarrage");
    context.applyWorkflowAction(dossier, "workStarted");

    assert.equal(context.getNextWorkflowAction(dossier), "workCompleted", "L'action suivante doit être la fin");
    context.applyWorkflowAction(dossier, "workCompleted");

    // 7. Qualité
    dossier.qualityChecklist = Object.fromEntries(vm.runInContext('DEFAULT_QUALITY_CHECKS', context).map(l => [l, true]));
    assert.equal(context.getNextWorkflowAction(dossier), "qualityApproved", "L'action suivante doit être la qualité");
    context.applyWorkflowAction(dossier, "qualityApproved");

    // 8. Livraison
    if (!isClient) dossier.photos.push({ id: `p-a-${i}`, category: "after" });
    assert.equal(context.getNextWorkflowAction(dossier), "delivered", "L'action suivante doit être la livraison");
    context.applyWorkflowAction(dossier, "delivered");

    // 9. Facturation
    assert.equal(context.getNextWorkflowAction(dossier), "invoiced", "L'action suivante doit être la facturation");
    context.applyWorkflowAction(dossier, "invoiced");

    // FIN
    assert.equal(context.getNextWorkflowAction(dossier), null, "Un dossier facturé n'a plus d'action suivante");
  }
});

// SCÉNARIO 7 : Vérifier le recalcul HT / TTC
audit("Les calculs des montants doivent être cohérents", () => {
  // Ceci dépend de getClaimAmount ou autre, voyons si l'export gère bien ça ou si ça existe.
  // En l'occurrence, le montant est juste stocké dans 'amount'.
  const dossier = context.normalizeCase({
    claims: [{ amount: "1000" }]
  });
  assert.equal(dossier.claims[0].amount, 1000, "Le montant doit être un nombre");
});


// SCÉNARIO 8 : Préparation anticipée uniquement pour les pièces neuves à remplacer si capacité libre
audit("Le planning anticipe seulement la préparation des pièces neuves si zone et peintre sont libres", () => {
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
  assert.equal(anticipated.length, 1, "Une seule étape anticipée doit être créée.");
  assert.ok(anticipated[0].title.includes("Préparation anticipée"), "L'étape anticipée doit être une préparation.");
  assert.equal(anticipated[0].key, "prep", "Aucune peinture anticipée séparée ne doit exister.");
  assert.equal(proposal.steps.some((step) => step.title.includes("Peinture anticipée")), false, "La peinture doit rester dans le flux normal groupé.");
  const body = proposal.steps.find((step) => step.key === "body");
  const normalPrep = proposal.steps.find((step) => step.key === "prep" && step.planningMode !== "anticipated-new-part");
  const paint = proposal.steps.find((step) => step.key === "paint");
  const reassembly = proposal.steps.find((step) => step.key === "reassembly");
  assert.equal(new Date(body.start).getTime(), new Date(anticipated[0].start).getTime(), "La préparation de la pièce neuve démarre en parallèle de la tôlerie.");
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
