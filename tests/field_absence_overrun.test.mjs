import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function fixture() {
  const vm = createNimrVmContext();
  vm.run(`state = normalizeState({
    currentUserId: 'chef', users: [{ id:'chef', name:'Chef', role:'chef_atelier', active:true }],
    resources: [{id:'tech', name:'Technicien', role:'mecanicien', active:true}],
    cases: [{id:'case', clientName:'Fixture', flags:{received:true}}],
    bookings: [{id:'work', caseId:'case', key:'mechanic', title:'Diagnostic', status:'planned',
      resourceIds:['tech'], start:'2026-09-09T08:00:00', end:'2026-09-09T10:00:00',
      segments:[{start:'2026-09-09T08:00:00', end:'2026-09-09T10:00:00'}]}]
  }); state.workHours = {3:[['08:00','12:00'],['13:00','17:00']]};`);
  return vm;
}

test('recording an absence preserves overlapping work and returns actionable impacts', () => {
  const vm = fixture();
  const before = vm.run('JSON.stringify(state.bookings[0])');
  const result = vm.run(`recordResourceLeave({resourceId:'tech', start:'2026-09-09T09:00:00', end:'2026-09-09T11:00:00', label:'Absence'})`);
  assert.equal(result.ok, true);
  assert.equal(result.impacts.length, 1);
  assert.equal(vm.run('JSON.stringify(state.bookings[0])'), before);
  assert.equal(vm.run(`getTechnicianLeaveConflicts('tech', new Date('2026-09-09T09:00:00'), new Date('2026-09-09T10:00:00')).length`), 1);
  assert.equal(vm.run(`normalizeState(JSON.parse(JSON.stringify(state))).bookings.filter(b => b.type === 'leave').length`), 1);
});

test('absence impact excludes finished, cancelled, deleted and unplanned work; catches active overruns', () => {
  const vm = fixture();
  for (const status of ['completed', 'cancelled', 'unplanned']) {
    vm.run(`state.bookings[0].status = '${status}'`);
    assert.equal(vm.run(`getResourceLeaveConflicts('tech', new Date('2026-09-09T09:00:00'), new Date('2026-09-09T11:00:00')).length`), 0);
  }
  vm.run(`Object.assign(state.bookings[0], {status:'started', startedAt:'2026-09-09T08:00:00'})`);
  assert.equal(vm.run(`getResourceLeaveConflicts('tech', new Date('2026-09-09T10:30:00'), new Date('2026-09-09T12:00:00'), new Date('2026-09-09T11:00:00')).length`), 1);
  vm.run(`state.bookings[0].deletedAt = '2026-09-09T09:00:00'`);
  assert.equal(vm.run(`getResourceLeaveConflicts('tech', new Date('2026-09-09T09:00:00'), new Date('2026-09-09T11:00:00')).length`), 0);
});

test('invalid absence and duplicate submission never add a second reservation', () => {
  const vm = fixture();
  for (const resourceId of ['missing', '']) assert.equal(vm.run(`recordResourceLeave({resourceId:'${resourceId}', start:'2026-09-09T09:00:00', end:'2026-09-09T11:00:00'}).ok`), false);
  for (const end of ['invalid', '2026-09-09T08:00:00']) assert.equal(vm.run(`recordResourceLeave({resourceId:'tech', start:'2026-09-09T09:00:00', end:'${end}'}).ok`), false);
  const expression = `recordResourceLeave({resourceId:'tech', start:'2026-09-09T09:00:00', end:'2026-09-09T11:00:00',label:'Absence'})`;
  assert.equal(vm.run(expression).ok, true);
  assert.equal(vm.run(expression).ok, false);
  assert.equal(vm.run(`state.bookings.filter(b => b.type === 'leave').length`), 1);
});

test('reception cannot record an absence', () => {
  const vm = fixture();
  vm.run(`state.users[0].role = 'reception'`);
  assert.equal(vm.run(`recordResourceLeave({resourceId:'tech', start:'2026-09-09T09:00:00', end:'2026-09-09T11:00:00'}).ok`), false);
  assert.equal(vm.run('state.bookings.length'), 1);
});

test('actual time extends past planned end and excludes the midday closure', () => {
  const vm = fixture();
  vm.run(`state.bookings[0].workSessions = [{startedAt:'2026-09-09T08:00:00'}]`);
  assert.equal(vm.run(`estimateBookingWorkedMinutes(state.bookings[0], new Date('2026-09-09T11:00:00'))`), 180);
  assert.equal(vm.run(`estimateBookingWorkedMinutes(state.bookings[0], new Date('2026-09-09T14:00:00'))`), 300);
});

test('actual time counts closed sessions once, respects pauses and does not fabricate unstarted work', () => {
  const vm = fixture();
  assert.equal(vm.run(`estimateBookingWorkedMinutes(state.bookings[0], new Date('2026-09-09T14:00:00'))`), 0);
  vm.run(`state.bookings[0].workSessions = [
    {startedAt:'2026-09-09T08:00:00', pausedAt:'2026-09-09T09:00:00'},
    {startedAt:'2026-09-09T08:00:00', pausedAt:'2026-09-09T09:00:00'},
    {startedAt:'2026-09-09T10:00:00', completedAt:'2026-09-09T12:00:00'}]`);
  assert.equal(vm.run(`estimateBookingWorkedMinutes(state.bookings[0], new Date('2026-09-10T14:00:00'))`), 180);
});

test('overrun pause preserves actual minutes and creates an unplanned remainder requiring an estimate', () => {
  const vm = fixture();
  vm.run(`const now = new Date(); const from = new Date(now.getTime() - 90 * 60000).toISOString();
    const until = new Date(now.getTime() - 30 * 60000).toISOString();
    Object.assign(state.bookings[0], {key:'mechanical',status:'started',start:from,end:until,startedAt:from,
      plannedMinutes:60, segments:[{start:from,end:until}], plannedSegments:[{start:from,end:until}],
      workSessions:[{startedAt:from}]});
    state.workHours[now.getDay()] = [['00:00','23:59']];`);
  const result = vm.run(`pauseCaseBookingTask(state.cases[0], 'work', 'Technicien absent')`);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.booking.actualWorkedMinutes, 90);
  assert.equal(result.booking.status, 'paused');
  assert.equal(result.remainder.needsScheduling, true);
  assert.equal(result.remainder.remainingEstimateRequired, true);
  assert.equal(result.remainder.plannedMinutes, 0);
  assert.equal(result.remainder.segments.length, 0);
  vm.context.remainderId = result.remainder.id;
  assert.equal(vm.run(`normalizeState(JSON.parse(JSON.stringify(state))).bookings.find(b=>b.id===remainderId).remainingEstimateRequired`), true);
  assert.equal(vm.run(`getTechnicianTaskStartIssues(state.cases[0], state.bookings.find(b=>b.id===remainderId), 'tech').some(x=>/estimer/.test(x))`), true);
  assert.equal(vm.run(`rescheduleCaseBooking(state.cases[0], remainderId, new Date(), {previewOnly:true}).ok`), false);
});

test('an estimated remainder retains task constraints and can be planned without changing previous pointages', () => {
  const vm = fixture();
  vm.run(`Object.assign(state.bookings[0], {key:'mechanical', taskId:'source-task', sourceKind:'manual', sourceClaimIds:['claim'], sourceLineIds:['line'], parallelizable:true, vehicleExclusive:false, requiredCategory:'mecanicien', capacityUnits:2});
    state.resources.push(normalizeResource({id:'bridge',name:'Pont',role:'pont_mecanique'}));
    state.bookings[0].equipmentResourceIds = ['bridge'];
    state.bookings[0].resourceIds.push('bridge');
    for (let day = 0; day < 7; day++) state.workHours[day] = [['08:00','12:00'],['13:00','17:00']];
    const original = JSON.stringify(state.bookings[0].workSessions);
    const remainder = createPausedBookingRemainder(state.cases[0], state.bookings[0], 0, 'Dépassement', new Date('2026-09-10T08:00:00'));
    globalThis.remainderId = remainder.id;`);
  for (const field of ['taskId','parallelizable','vehicleExclusive','requiredCategory','capacityUnits']) {
    assert.equal(vm.run(`state.bookings.find(b=>b.id===remainderId)[${JSON.stringify(field)}]`), vm.run(`state.bookings[0][${JSON.stringify(field)}]`), field);
  }
  assert.equal(vm.run(`state.bookings.find(b=>b.id===remainderId).sourceLineIds[0]`), 'line');
  const result = vm.run(`rescheduleCaseBooking(state.cases[0], remainderId, new Date('2026-09-10T08:00:00'), {durationMinutes:45})`);
  assert.equal(result.ok, true, result.message);
  assert.equal(vm.run(`state.bookings.find(b=>b.id===remainderId).plannedMinutes`),45);
  assert.equal(vm.run(`state.bookings.find(b=>b.id===remainderId).remainingEstimateRequired`),false);
  assert.equal(vm.run(`state.bookings.find(b=>b.id===remainderId).needsScheduling`),false);
  assert.equal(vm.run('JSON.stringify(state.bookings[0].workSessions) === original'),true);
});
