import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';

function fixture() {
  const vm = createNimrVmContext();
  vm.run(`state = normalizeState({
    users: [{id:'chief',name:'Chef',role:'chef_atelier',active:true}, {id:'front',name:'Conseiller',role:'reception',active:true}],
    currentUserId:'chief', resources:[{id:'tech',name:'Mécanicien',role:'mecanicien',active:true}],
    cases:[{id:'car',plate:'111TU222',vehicle:'Véhicule test',createdAt:'2026-09-01T08:00:00Z',
      flags:{received:true}, receptionWorkflow:{vehicleReceivedAt:'2026-09-01T08:00:00Z'},
      claims:[{id:'order',type:'mechanical_client',title:'Alternateur',includeInPlanning:true,clientApproved:true,
        authorizationReference:'OR-2026-001',
        estimate:{lines:[{phase:'mechanical',operation:'Remplacer alternateur',laborHours:1}]}}]}],
    bookings:[{id:'job',caseId:'car',type:'work',key:'mechanical',title:'Remplacer alternateur',status:'planned',
      start:'2026-09-07T08:00:00Z',end:'2026-09-07T09:00:00Z',plannedMinutes:60,remainingMinutes:60,
      resourceIds:['tech'],businessTaskId:'job'}]
  }); invalidateUiRuntimeIndexes();`);
  return { ...vm, c: vm.context, item: vm.run('state.cases[0]'), booking: vm.run('state.bookings[0]') };
}

test('unstarted work with a planned duration does not request a resume', () => {
  const {c,item} = fixture();
  assert.equal(c.getCaseNextAction(item).code,'start_work');
});

test('ready uses the delivery guards, including remaining work, parts and customer complaints', () => {
  const {c,item,booking} = fixture();
  item.flags.workCompleted = true; item.flags.qualityApproved = true;
  assert.equal(c.isCaseReadyForDelivery(item),false,'operation still open');
  booking.status='completed'; booking.remainingMinutes=0;
  assert.equal(c.isCaseReadyForDelivery(item),true);
  item.partsStatus='waiting_parts';
  assert.equal(c.isCaseReadyForDelivery(item),false,'parts wait blocks handover');
  assert.equal(c.getCaseOperationalPhase(item).key,'finalizing');
  item.partsStatus='available'; item.blockerReason='';
  item.customerClaims=[{id:'complaint',status:'unresolved'}];
  assert.equal(c.isCaseReadyForDelivery(item),false,'unresolved customer complaint');
  assert.equal(c.getCaseNextAction(item).code,'review_finalization');
});

test('quality rejection calls for a correction rather than an ordinary final check', () => {
  const {c,item,booking} = fixture();
  booking.status='completed'; booking.remainingMinutes=0; item.flags.workCompleted=true;
  item.receptionWorkflow.qualityStatus='rejected';
  item.receptionWorkflow.qualityReturnReason='Bruit au freinage';
  assert.equal(c.getCaseNextAction(item).label,'Corriger l’anomalie qualité');
});

test('an unstarted blocked operation is not counted as current execution', () => {
  const {c,item,booking} = fixture();
  booking.status='blocked'; booking.blockReason='Pièce manquante';
  const summary = c.buildWorkshopLiveCaseTaskSummary(item,new Date('2026-09-07T08:30:00Z'));
  assert.equal(summary.active,0);
  assert.equal(summary.current,null);
  assert.ok(c.getOperationalExceptions(item).some(e=>e.code==='blocked'));
});

test('a blocked operation with actual execution remains the interrupted current operation', () => {
  const {c,item,booking} = fixture();
  booking.status='blocked'; booking.blockReason='Pièce manquante'; booking.actualStart='2026-09-07T08:00:00Z';
  const summary = c.buildWorkshopLiveCaseTaskSummary(item,new Date('2026-09-07T08:30:00Z'));
  assert.equal(summary.active,1);
});

test('a workshop assignee and deadline never replace client deadlines', () => {
  const {c,item} = fixture();
  item.clientCommitment={promisedAt:'2026-09-07T08:00:00Z',nextContactAt:'2026-09-07T07:00:00Z'};
  item.partsStatus='waiting_parts';
  item.exceptionFollowup={ownerId:'chief',dueAt:'2026-09-07T09:00:00Z'};
  const exceptions=c.getOperationalExceptions(item,new Date('2026-09-07T10:00:00Z'));
  const contact=exceptions.find(e=>e.code==='contact');
  const promise=exceptions.find(e=>e.code==='promise_late');
  assert.equal(contact.owner,'Réception');
  assert.equal(contact.dueAt,item.clientCommitment.nextContactAt);
  assert.equal(promise.dueAt,item.clientCommitment.promisedAt);
  assert.ok(exceptions.some(e=>e.code==='decision_late'));
  assert.equal(exceptions[0].code,'blocked');
  assert.equal(c.getPrimaryOperationalException(exceptions,'reception').code,'promise_late');
});

test('a recent customer call does not conceal a stationary vehicle', () => {
  const {c,item} = fixture();
  item.history=[{at:'2026-09-07T10:00:00Z',type:'client.commitment'}];
  const last=c.getWorkshopProgressLastActivityAt(item,{flowOnly:true});
  assert.equal(last.toISOString(),'2026-09-01T08:00:00.000Z');
  assert.ok(c.getOperationalExceptions(item,new Date('2026-09-07T10:00:00Z')).some(e=>e.code==='stale'));
});

test('reception counts expected and physically present vehicles separately', () => {
  const {c,run} = fixture();
  run(`state.currentUserId='front'; state.cases.push(normalizeCase({id:'expected',plate:'222TU333',flags:{received:false}})); invalidateUiRuntimeIndexes();`);
  const model=c.buildWorkshopProgressBoardModel(new Date('2026-09-07T10:00:00Z'),{filter:'all',search:''});
  assert.equal(model.total,2); assert.equal(model.present,1); assert.equal(model.expected,1);
});

test('an operation still running is not classified as a stationary vehicle by the filter', () => {
  const {c,item,booking} = fixture();
  booking.status='started'; booking.actualStart='2026-09-01T08:00:00Z';
  const row=c.buildWorkshopProgressRow(item,new Date('2026-09-07T10:00:00Z'));
  assert.equal(row.stale,false);
  assert.equal(c.workshopProgressRowMatchesFilter(row,'stale'),false);
  assert.ok(!row.exceptions.some(e=>e.code==='stale'));
});

test('the vehicle card does not label a future assigned technician as unassigned', () => {
  const {c,item} = fixture();
  const html=c.renderWorkshopProgressRow(c.buildWorkshopProgressRow(item,new Date('2026-09-07T08:00:00Z')));
  assert.match(html,/Ensuite :.*Mécanicien/);
  assert.doesNotMatch(html,/>Non affecté</);
});

test('canceling an action preserves previously disabled technician buttons', async () => {
  const {c} = fixture();
  const button=disabled=>({disabled,isConnected:true,setAttribute(name){if(name==='disabled')this.disabled=true;}});
  const buttons=[button(false),button(true)];
  c.document.querySelectorAll=()=>buttons;
  c.showInputPromptModal=async()=>null;
  await c.handleTechnicianTaskAction('pause','job','tech');
  assert.equal(buttons[0].disabled,false);
  assert.equal(buttons[1].disabled,true);
});

test('a failed durable save never emits an action success message', async () => {
  const {c} = fixture();
  const messages=[];
  c.document.querySelectorAll=()=>[];
  c.showInputPromptModal=async()=>'Observation';
  c.addTechnicianTaskNote=()=>({ok:true,message:'Success'});
  c.saveState=async()=>false;
  c.notifyUser=(message,level)=>messages.push({message,level});
  c.quietNotify=(message,level)=>messages.push({message,level});
  c.render=()=>{};
  await c.handleTechnicianTaskAction('note','job','tech');
  assert.ok(messages.some(m=>m.level==='error'));
  assert.ok(!messages.some(m=>m.level==='success'));
});

test('a visible decision cannot modify a case replaced or changed since it was read', () => {
  const {c,run,item} = fixture();
  c.notifyUser=()=>{};
  const revision=c.getVisibleCaseRevision(item);
  assert.equal(c.guardVisibleCaseRevision(item,revision).ok,true);
  item.syncRevision=10;
  assert.equal(c.guardVisibleCaseRevision(item,revision).ok,false);
  const nextRevision=c.getVisibleCaseRevision(item);
  run('state.cases[0] = normalizeCase(JSON.parse(JSON.stringify(state.cases[0])))');
  assert.equal(c.guardVisibleCaseRevision(item,nextRevision).ok,false);
});
