import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function fixture() {
  const app = createNimrVmContext();
  const output = [];
  app.context.open = () => ({document:{write:html => output.push(html), close() {}}});
  app.run(`state = normalizeState({ currentUserId:'chef', users:[{id:'chef',name:'Chef',role:'chef_atelier',active:true}],
    resources:[{id:'tech',name:'Technicien démonstration',role:'mecanicien',active:true},{id:'bridge',name:'Pont démonstration',role:'pont_mecanique',active:true}],
    cases:[{id:'case',clientName:'Client démonstration',phone:'PHONE-SECRET',insurance:'INSURANCE-SECRET',orNavNumber:'OR-DEMO-040',plate:'123 TU 456',vehicle:'Véhicule démonstration',visitReason:'Bruit au freinage à froid',blockerDetails:'Vérifier la fixation avant essai',flags:{received:true},
      claims:[{id:'claim',type:'client',title:'Intervention',estimate:{lines:[{id:'line',phase:'mechanical',operation:'Contrôler le freinage et ses fixations',laborHours:1.5}],parts:[{designation:'Plaquettes de frein',quantity:1,unitPrice:10,amount:10}]}}]}],
    bookings:[{id:'work',caseId:'case',key:'mechanical',title:'Contrôler le freinage et ses fixations',resourceIds:['tech','bridge'],primaryResourceId:'tech',
      start:'2026-09-09T08:00:00',end:'2026-09-09T09:30:00',segments:[{start:'2026-09-09T08:00:00',end:'2026-09-09T09:30:00'}]}]});`);
  return {app, output};
}

const entries = [
  ['01-ordre-atelier', `printRepairOrder(state.cases[0])`, false],
  ['02-ordres-techniciens', `printTechnicianWorkOrders(state.cases[0])`, false],
  ['03-planning-tableau', `printDailyPlanning('2026-09-09')`, true],
  ['04-planning-gantt', `printDailyPlanningGantt('2026-09-09')`, true],
  ['05-fiche-tache', `printTechnicianTaskSheet(state.cases[0], 'work', 'tech')`, false],
  ['06-fiche-pause', `printPauseBlockSheet(state.cases[0], 'work', 'tech')`, false],
  ['07-ordre-complementaire', `state.cases[0].supplements = [{id:'supplement', title:'Recherche complémentaire', reason:'Contrôle à froid', laborLines:[{phase:'mechanical',operation:'Investigation complémentaire',laborHours:0.5}]}]; printSupplementWorkOrders(state.cases[0])`, false],
];

for (const [name, expression, landscape] of entries) test(`${name}: A4, page identity, concise content and printable output`, () => {
  const {app, output} = fixture();
  app.run(expression);
  assert.equal(output.length, 1);
  const html = output[0];
  assert.match(html, /OR-DEMO-040/);
  assert.match(html, /counter\(page\)/);
  assert.match(html, /table-header-group/);
  assert.match(html, landscape ? /size:\s*A4 landscape/ : /size:\s*A4 portrait/);
  assert.doesNotMatch(html, /PHONE-SECRET|INSURANCE-SECRET/);
  if (name !== '07-ordre-complementaire') assert.match(html, /Contrôler le freinage et ses fixations/);
  if (name === '01-ordre-atelier') assert.match(html, /Plaquettes de frein/);
  if (name === '04-planning-gantt') {
    assert.match(html, /equipment-annex\{display:none\}/);
    assert.match(html, /Joindre le planning des équipements/);
    assert.doesNotMatch(html, /min-width:\s*(?:1[0-9]|[2-9][0-9])px/);
  }
  if (process.env.NIMR_PRINT_QA_DIR) {
    fs.mkdirSync(process.env.NIMR_PRINT_QA_DIR, {recursive:true});
    fs.writeFileSync(path.join(process.env.NIMR_PRINT_QA_DIR, name + '.html'), html.replace(/<script>[\s\S]*?<\/script>/g, ''));
  }
});

test('day sheets exclude cancelled, deleted, unplanned and absence reservations', () => {
  const {app, output} = fixture();
  for (const change of ["{deletedAt:'2026-09-09T10:00:00'}", "{status:'cancelled'}", "{needsScheduling:true}", "{type:'leave'}"]) {
    app.run(`const copy${output.length} = {...state.bookings[0], id:'hidden${output.length}', title:'DO-NOT-PRINT', ...${change}}; state.bookings.push(copy${output.length}); printDailyPlanning('2026-09-09');`);
  }
  assert.ok(output.every(html => !html.includes('DO-NOT-PRINT')));
});

test('print content escapes markup and cannot close a stylesheet through the reference', () => {
  const {app, output} = fixture();
  app.run(`state.cases[0].orNavNumber = '<' + '/style><script>attack()</script>'; printRepairOrder(state.cases[0]);`);
  assert.doesNotMatch(output[0], /<script>attack/);
  assert.match(output[0], /\\3c /);
});

test('repair order retains real chassis and brake parts while excluding explicit imported identity fields', () => {
  const {app, output} = fixture();
  app.run(`state.cases[0].claims[0].estimate.parts.push(
    {designation:'Châssis support de radiateur',quantity:1},
    {designation:'VIN : LABCDEFG123456789',quantity:1},
    {designation:'PLAQ : LABCDEFG123456789',quantity:1}
  ); printRepairOrder(state.cases[0]);`);
  assert.match(output[0], /Châssis support de radiateur/);
  assert.doesNotMatch(output[0], /LABCDEFG123456789/);
});
