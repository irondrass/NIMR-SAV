import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function fixture() {
  const vm = createNimrVmContext();
  vm.run(`state = normalizeState({currentUserId:'reception',
    users:[{id:'reception',name:'Réception',role:'reception',active:true}],
    cases:[{id:'case',clientName:'Fixture',flags:{received:true},claims:[]}]});`);
  vm.context.requestInput = { title:'Bruit à froid', type:'request', status:'open', responsibleUserId:'reception', nextAction:'Reproduire à froid', reviewAt:'2026-09-09T09:00:00' };
  return vm;
}

test('unknown diagnostic can exist without hours and never promises the slot end', () => {
  const vm = fixture();
  vm.run(`state.cases[0].claims = [normalizeRepairClaim({type:'diagnostic',durationMode:'investigation'})];
    state.cases[0].appointment = {delivery:'2026-09-09T12:00:00'};`);
  assert.equal(vm.run('state.cases[0].claims[0].durationMode'), 'investigation');
  assert.equal(vm.run('getWorkshopProgressEta(state.cases[0])'), null);
  assert.equal(vm.run(`getCaseFinalizationIssues(state.cases[0]).some(issue => /conclusion du diagnostic/.test(issue))`), true);
  assert.match(vm.run('renderClaimCard(state.cases[0].claims[0], 0)'), /Durée totale inconnue/);
  assert.equal(vm.run(`normalizeRepairClaim(JSON.parse(JSON.stringify(state.cases[0].claims[0]))).durationMode`), 'investigation');
});

test('request requires owner, action and review, survives normalization and appears overdue', () => {
  const vm = fixture();
  for (const field of ['title','responsibleUserId','nextAction','reviewAt']) {
    assert.equal(vm.run(`recordCustomerRequest(state.cases[0], '', {...requestInput, ${field}:''}).ok`), false);
  }
  const result = vm.run(`recordCustomerRequest(state.cases[0], '', requestInput)`);
  assert.equal(result.ok, true, result.message);
  assert.equal(vm.run(`normalizeState(JSON.parse(JSON.stringify(state))).cases[0].customerClaims[0].nextAction`), 'Reproduire à froid');
  assert.equal(vm.run(`getOperationalExceptions(state.cases[0], new Date('2026-09-09T10:00:00')).some(e => e.code === 'customer_request' && e.severity === 'danger')`), true);
  assert.equal(vm.run('state.cases[0].customerClaims[0].comments.length'), 1);
});

test('closure records a distinct outcome, notification and history; a refusal is not presented as fixed', () => {
  const vm = fixture();
  const created = vm.run(`recordCustomerRequest(state.cases[0], '', requestInput)`);
  vm.context.requestId = created.request.id;
  const close = `recordCustomerRequest(state.cases[0], requestId, {...requestInput, status:'resolved', outcome:'declined', note:'Client refuse la recherche complémentaire', customerNotified:true})`;
  assert.equal(vm.run(close.replace('customerNotified:true','customerNotified:false')).ok, false);
  assert.equal(vm.run(close.replace("note:'Client refuse la recherche complémentaire'", "note:''")).ok, false);
  const result = vm.run(close);
  assert.equal(result.ok, true);
  assert.equal(result.request.outcome, 'declined');
  assert.equal(result.request.reviewAt, null);
  assert.equal(result.request.comments.length, 2);
  assert.ok(result.request.customerNotifiedAt);
  assert.equal(vm.run(`getCaseFinalizationIssues(state.cases[0]).some(issue => /réclamations client/.test(issue))`), false);
  assert.equal(vm.run(`recordCustomerRequest(state.cases[0], requestId, {...requestInput, status:'in_progress'}).ok`), true);
  assert.equal(vm.run('state.cases[0].customerClaims[0].resolvedAt'), '');
  assert.equal(vm.run('state.cases[0].customerClaims[0].comments.length'), 3);
});

test('invalid identities, foreign booking and technician edits fail without mutations', () => {
  const vm = fixture();
  assert.equal(vm.run(`recordCustomerRequest(state.cases[0], 'missing', requestInput).ok`), false);
  assert.equal(vm.run(`recordCustomerRequest(state.cases[0], '', {...requestInput, linkedBookingId:'another-case'}).ok`), false);
  assert.equal(vm.run(`recordCustomerRequest(state.cases[0], '', {...requestInput, reviewAt:'abc'}).ok`), false);
  vm.run(`state.users[0].role='technicien'`);
  assert.equal(vm.run(`recordCustomerRequest(state.cases[0], '', requestInput).ok`), false);
  assert.equal(vm.run('state.cases[0].customerClaims.length'), 0);
});

test('minimal arrival accepts absent or international phone and rejects alphabetic, short or excessive input', () => {
  const vm = fixture();
  for (const phone of ['', '+216 55 123 456', '01 23 45 67 89']) {
    vm.context.testPhone = phone;
    assert.ok(vm.run(`createMinimalReceptionCase({identity:'123 TU 456', visitReason:'Diagnostic', phone:testPhone}).id`));
  }
  const count = vm.run('state.cases.length');
  for (const phone of ['abc', '-20', '1e10', '1234567890123456']) {
    vm.context.testPhone = phone;
    assert.throws(() => vm.run(`createMinimalReceptionCase({identity:'123 TU 456', visitReason:'Diagnostic', phone:testPhone})`), /téléphone/i);
  }
  assert.equal(vm.run('state.cases.length'), count);
});

test('a further investigation slot preserves previous bookings and actual work and requires chief scheduling', async () => {
  const vm = fixture();
  vm.run(`state.resources = [normalizeResource({id:'tech',role:'mecanicien'})];
    state.cases[0].claims = [normalizeRepairClaim({id:'claim',type:'diagnostic',durationMode:'investigation'})];
    state.cases[0].flags.workStarted = true;
    state.bookings = [normalizeBooking({id:'previous',caseId:'case',key:'mechanical',resourceIds:['tech'],status:'completed',start:'2026-09-09T08:00:00',end:'2026-09-09T09:00:00',segments:[{start:'2026-09-09T08:00:00',end:'2026-09-09T09:00:00'}],actualWorkedMinutes:75,workSessions:[{startedAt:'2026-09-09T08:00:00',completedAt:'2026-09-09T09:15:00'}]},new Set(['tech']))];
    globalThis.previousBooking = JSON.stringify(state.bookings[0]);`);
  vm.context.FormData = class { get(key) { return {phase:'mechanical',operation:'Reproduire le bruit à froid',laborHours:'0,75'}[key]; } };
  vm.context.renderCaseDetail = () => {};
  await vm.run(`handleClaimLaborSubmit({preventDefault(){},currentTarget:{dataset:{claimId:'claim'},elements:{},reset(){}}},state.cases[0])`);
  assert.equal(vm.run('JSON.stringify(state.bookings[0])'), vm.run('previousBooking'));
  assert.equal(vm.run('state.bookings.length'),2);
  assert.equal(vm.run('state.bookings[1].needsScheduling'),true);
  assert.equal(vm.run('state.bookings[1].plannedMinutes'),45);
  assert.equal(vm.run('state.bookings[1].sourceClaimIds[0]'),'claim');
  assert.equal(vm.run('state.cases[0].flags.received'),true);
  assert.equal(vm.run('state.cases[0].flags.workStarted'),true);
  assert.equal(vm.run('getWorkshopProgressEta(state.cases[0])'),null);
});
