import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({ console, window: { addEventListener() {} }, document: { addEventListener() {} }, localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; } } });
for (const file of ['js/utils.js', 'js/state.js', 'js/rdv-integration.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const run = code => vm.runInContext(code, context);
run(`var payload = { id: 'a1', date: '2026-09-29T08:00:00Z', status: 'confirmed', access_token: 'discard', intervention: { id: 'i1', km: 1200, description: 'Vidange', quoteNumber: 'QUOTE-99', vehicle: { id: 'v1', chassisNumber: 'VIN123456789012345', registrationNumber: '123 TU 456', client: { id: 'c1', firstName: 'Alice', lastName: 'Test', phones: [{ number: '22123456' }] } }, service: { id: 's1', agencyId: 'agency' } } }; var row = normalizeTeamdevAppointment(payload);`);

test('whitelisted DTO and optional metadata survive normalization; quote is never an OR', () => {
  assert.equal(run('row.rdvIntegration.interventionId'), 'i1');
  assert.equal(run('JSON.stringify(row).includes("discard")'), false);
  assert.equal(run('JSON.stringify(row).includes("QUOTE-99")'), false);
  assert.equal(run('normalizeCase({rdvIntegration: row.rdvIntegration}).rdvIntegration.appointmentId'), 'a1');
  assert.equal(run('normalizeCase({}).rdvIntegration'), undefined);
  assert.equal(run('normalizeRdvIntegration({provider: "other"})'), null);
});
test('company client falls back to Teamdev socialReason when first and last names are empty', () => {
  assert.equal(run(`normalizeTeamdevAppointment({...payload, intervention: {...payload.intervention, vehicle: {...payload.intervention.vehicle, client: {...payload.intervention.vehicle.client, firstName: '', lastName: '', socialReason: 'STE NIMR TEST'}}}}).clientName`), 'STE NIMR TEST');
  assert.equal(run(`normalizeTeamdevAppointment({...payload, intervention: {...payload.intervention, vehicle: {...payload.intervention.vehicle, client: {...payload.intervention.vehicle.client, firstName: 'Ali', lastName: 'Ben', socialReason: 'STE SHOULD NOT REPLACE'}}}}).clientName`), 'Ali Ben');
});

test('planning clear and replan preserve external snapshot', () => {
  run(`var item = normalizeCase({ id: 'local', rdvIntegration: row.rdvIntegration, appointment: {start: payload.date} }); var snapshot = JSON.stringify(item.rdvIntegration); state.bookings = []; clearCasePlanning(item); item.appointment = {start: '2026-10-01T09:00:00Z'}; item = normalizeCase(item);`);
  assert.equal(run('JSON.stringify(item.rdvIntegration) === snapshot'), true);
});
test('matching prioritizes intervention then appointment; ambiguous identities fail closed', () => {
  run(`var a = {id:'a', rdvIntegration:{provider:'teamdev-rdv', interventionId:'i1'}}; var b = {id:'b', rdvIntegration:{provider:'teamdev-rdv', appointmentId:'a1'}}; var identity = {id:'c', vin:row.vin, phone:row.phone};`);
  assert.equal(run('matchRdvCase(row, [b,a,identity]).item.id'), 'a');
  assert.equal(run('matchRdvCase(row, [b,identity]).item.id'), 'b');
  assert.equal(run('matchRdvCase(row, [identity]).item.id'), 'c');
  assert.equal(run('matchRdvCase(row, [identity,{...identity,id:"d"}]).item'), null);
  assert.equal(run('matchRdvCase(row, [{vin:row.vin}]).item'), null);
  assert.equal(run('matchRdvCase(row, [{...identity, flags:{delivered:true}}]).item'), null);
});
test('hydration fills only empty safe facts, preserves planning and physical reception', () => {
  run(`var original = {mileage:'55',visitReason:'Local',appointment:{start:'internal'},flags:{received:true},receptionWorkflow:{vehicleMileageEntry:'55'}}; var hydrated = hydrateRdvCase(original,row);`);
  assert.equal(run('hydrated.mileage'), '55');
  assert.equal(run('hydrated.visitReason'), 'Local');
  assert.equal(run('hydrated.appointment === original.appointment'), true);
  assert.equal(run('hydrateRdvCase({flags:{received:true}},row).mileage'), undefined);
  assert.equal(run('hydrateRdvCase({},row).mileage'), '1200');
  assert.equal(run('hydrateRdvCase({},row).visitReason'), 'Vidange');
  assert.equal(run('hydrateRdvCase({},row).orNavNumber'), undefined);
});
test('late uses appointment date and configurable minutes; canceled never closes local case', () => {
  assert.equal(run(`isRdvLate(row, new Date('2026-09-29T08:20:00Z'), 15)`), true);
  assert.equal(run(`isRdvLate(row, new Date('2026-09-29T08:20:00Z'), 30)`), false);
  assert.equal(run(`isRdvLate({...row,rdvIntegration:{...row.rdvIntegration,appointmentStatus:'canceled'}}, new Date('2026-09-29T09:00:00Z'), 15)`), false);
  assert.equal(run(`hydrateRdvCase(original, normalizeTeamdevAppointment({...payload,status:'canceled'})).flags.delivered`), undefined);
  assert.doesNotMatch(fs.readFileSync('js/rdv-integration.js','utf8'), /fetch\s*\(|86400000|24\s*\*\s*60/);
});
test('transport disabled unless explicitly injected, results sanitized', async () => {
  assert.equal((await run('loadRdvAppointments()')).enabled, false);
  assert.equal((await run('loadRdvAppointments(async () => ({result:[payload]}))')).rows.length, 1);
});
test('phones[] shape is not assumed: strings, objects and junk degrade safely to an empty phone', () => {
  const phoneOf = phones => run(`normalizeTeamdevAppointment({...payload, intervention: {...payload.intervention, vehicle: {...payload.intervention.vehicle, client: {...payload.intervention.vehicle.client, phones: ${JSON.stringify(phones)}}}}}).phone`);
  assert.equal(phoneOf([{ number: '22123456' }]), '22123456');
  assert.equal(phoneOf(['22123456']), '22123456');
  assert.equal(phoneOf([{ number: 22123456 }]), '22123456');
  assert.equal(phoneOf([null, {}, { number: '  ' }, '98765432']), '98765432');
  for (const junk of [[], [null], [{}], [42], [{ number: null }], [{ phone: '22123456' }], null, 'x', {}]) {
    assert.equal(phoneOf(junk), '', JSON.stringify(junk));
  }
  assert.equal(run(`normalizeTeamdevAppointment({...payload, intervention: {...payload.intervention, vehicle: {id: 'v1', client: null}}}).phone`), '');
});
