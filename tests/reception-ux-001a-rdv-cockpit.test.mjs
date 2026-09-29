import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { runMobileCdpTest, technicianFixtureExpression } from './helpers/mobile_browser_harness.mjs';

const elements = new Map();
const element = id => { if (!elements.has(id)) elements.set(id, {innerHTML:'',value:'',dataset:{},hidden:false,style:{},listeners:{},querySelector(){return null;},querySelectorAll(){return [];},addEventListener(type,fn){this.listeners[type]=fn;}}); return elements.get(id); };
const context = vm.createContext({console, window:{addEventListener(){}}, document:{getElementById:element,addEventListener(){}}, localStorage:{getItem(){return null;}},sessionStorage:{getItem(){return null;}}});
for (const file of ['js/utils.js','js/state.js','js/planning.js','js/rdv-integration.js','js/ui-cases.js','js/ui-reception.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
const run = code => vm.runInContext(code,context);
run(`var saves=0, saveCalls=[], opened=''; saveState=opts=>{saves++;saveCalls.push(opts);}; openOperationalCasePanel=id=>opened=id; renderCases=()=>{}; guardCaseCreate=()=>({ok:true}); guardCaseEdit=()=>({ok:true}); var payload={id:'a',date:'2026-09-29T08:00:00Z',status:'confirmed',intervention:{id:'i',vehicle:{chassisNumber:'VIN123456789012345',registrationNumber:'123 TU 456',client:{firstName:'Alice',phones:[{number:'22123456'}]}}}}; state.cases=[];`);
test('loading stays ephemeral; repeated link opens the same operational context once persisted', () => {
  run('setReceptionUpstreamAppointments({result:[payload]});');
  assert.equal(run('state.cases.length'),0);
  assert.equal(run('saves'),0);
  run('openReceptionUpstreamAppointment(0); openReceptionUpstreamAppointment(0);');
  assert.equal(run('state.cases.length'),1);
  assert.equal(run('opened === state.cases[0].id'),true);
  assert.equal(run('saves'),1);
  assert.equal(run('state.cases[0].appointment'),null);
  assert.equal(run('saveCalls[0].skipCloud'), undefined);
  assert.equal(run('saveCalls[0].flushCloud'), true);
  assert.equal(run('saveCalls[0].changedCase === state.cases[0]'), true);
  assert.equal(run('saveCalls[0].changedCase.rdvIntegration.interventionId'), 'i');
});
test('Today counters, quick filters and multichamp search include linked OR', () => {
  run(`state.cases[0].orNavNumber='OR-42'; state.cases.push(normalizeCase({id:'ready',flags:{received:true,workCompleted:true,qualityApproved:true},clientCommitment:{nextContactAt:'2026-09-29T07:00:00Z'}})); var today = getReceptionTodayRows(new Date('2026-09-29T08:20:00Z'));`);
  for (const query of ['Alice','22123456','VIN123456789012345','123 TU 456','OR-42']) assert.equal(run(`filterReceptionTodayRows(today,'all',${JSON.stringify(query)}).length`),1);
  assert.equal(run(`filterReceptionTodayRows(today,'expected','').length`),0);
  for (const filter of ['late','inform','ready-deliver']) assert.equal(run(`filterReceptionTodayRows(today,'${filter}','').length`),1);
  assert.equal(run('today.length'),2);
});
test('ready counter reuses finalization guard and excludes unresolved complaints', () => {
  run(`state.cases[1].customerClaims=[{status:'unresolved'}];`);
  assert.equal(run(`filterReceptionTodayRows(getReceptionTodayRows(new Date('2026-09-29T08:20:00Z')),'ready-deliver','').length`),0);
});

test('Reception Today excludes closed historical local cases', () => {
  run(`state.cases.push(normalizeCase({id:'closed-history',clientName:'Ancien dossier',flags:{delivered:true,invoiced:true},closedAt:'2026-09-28T17:00:00Z'})); var activeToday=getReceptionTodayRows(new Date('2026-09-29T08:20:00Z'));`);
  assert.equal(run(`activeToday.some(row => row.item?.id === 'closed-history')`), false);
});
test('upstream multichamp search works before creation and renders escaped text', () => {
  run(`state.cases=[]; var upstreamOnly=getReceptionTodayRows(new Date('2026-09-29T08:20:00Z'));`);
  for (const query of ['Alice','22123456','VIN123456789012345','123 TU 456']) assert.equal(run(`filterReceptionTodayRows(upstreamOnly,'all',${JSON.stringify(query)}).length`),1);
  run(`setReceptionUpstreamAppointments({result:[{...payload,intervention:{...payload.intervention,vehicle:{...payload.intervention.vehicle,client:{firstName:'<script>test</script>'}}}}]}); renderReceptionTodayCockpit('',new Date('2026-09-29T08:20:00Z'));`);
  assert.ok(!element('reception-case-list').innerHTML.includes('<script>'));
  run('setReceptionUpstreamAppointments({result:[payload]});');
});
test('delegated upstream click links an identity match, then opens R1/R2', () => {
  run(`state.cases=[normalizeCase({id:'identity',vin:'VIN123456789012345',phone:'22123456'})]; initReceptionWorkspace(); renderReceptionTodayCockpit('',new Date('2026-09-29T08:20:00Z'));`);
  assert.ok(element('reception-case-list').innerHTML.includes('data-rdv-index="0"'));
  element('reception-case-list').listeners.click({target:{closest(selector){return selector==='[data-rdv-index]' ? {dataset:{rdvIndex:'0'}} : null;}}});
  assert.equal(run('opened'),'identity');
  assert.equal(run('state.cases[0].rdvIntegration.interventionId'),'i');
  assert.equal(run('state.cases.length'),1);
});
test('ambiguous link and denied creation fail without persistence', () => {
  run(`state.cases=[normalizeCase({vin:'VIN123456789012345',phone:'22123456'}),normalizeCase({vin:'VIN123456789012345',phone:'22123456'})]; var before=saves; notifyUser=()=>{}; openReceptionUpstreamAppointment(0);`);
  assert.equal(run('saves === before'),true);
  run(`state.cases=[]; guardCaseCreate=()=>({ok:false}); openReceptionUpstreamAppointment(0);`);
  assert.equal(run('state.cases.length'),0);
});
test('runtime hooks retain operational panel and responsive layout with no execution controls', () => {
  const html=fs.readFileSync('index.html','utf8'), css=fs.readFileSync('styles.css','utf8');
  const utils=fs.readFileSync('js/utils.js','utf8'), appJs=fs.readFileSync('app.js','utf8');
  assert.match(html, /<button[^>]*data-tab="reception-workspace"[^>]*>[\s\S]{0,400}?Réception/);
  assert.match(utils, /reception:\s*\["reception-workspace",\s*"today",\s*"dossiers"\]/);
  assert.doesNotMatch(appJs, /tab === "reception-workspace"[^\n]*openReceptionNewEntryDialog/);
  for (const id of ['reception-today-cockpit','reception-case-search','reception-case-list','reception-today-counters','reception-new-entry-btn','reception-new-entry-dialog','reception-new-entry-panel']) assert.ok(html.includes(`id="${id}"`));
  for (const choice of ['rdv','walk-in','pdf','existing']) assert.ok(html.includes(`data-reception-entry="${choice}"`));
  assert.match(html, /id="reception-new-entry-panel"[^>]*hidden/);
  assert.ok(html.indexOf('js/rdv-integration.js') < html.indexOf('js/ui-reception.js'));
  assert.match(css,/reception-today-grid/);
  const ui=fs.readFileSync('js/ui-reception.js','utf8').split('const RECEPTION_QUICK_MOTIFS')[0];
  assert.match(ui,/openOperationalCasePanel/);
  assert.doesNotMatch(ui,/startBooking|pauseBooking|completeBooking|applyPlanning/);
  const inheritedUi = fs.readFileSync('js/ui-cases.js','utf8').normalize('NFD').replace(/\p{M}/gu,'');
  for (const label of ['Action reception','Suivi client','Synthese atelier']) assert.ok(inheritedUi.includes(label));
});

test('New Entry panel is not a direct view child, so global render() cannot reveal it', () => {
  const html=fs.readFileSync('index.html','utf8');
  const start=html.indexOf('<section class="view" id="view-reception-workspace">');
  const panel=html.indexOf('id="reception-new-entry-panel"', start);
  assert.ok(start>=0 && panel>start);
  let depth=0;
  for (const m of html.slice(start, html.lastIndexOf('<', panel)).matchAll(/<(\/?)(section|div|dialog)\b[^>]*>/g)) depth += m[1] ? -1 : 1;
  assert.ok(depth>=2, `panel depth ${depth}: direct children of the view are un-hidden by render()`);
});

test('browser: Today remains usable at 1440/1024/768/390 and links into the R1/R2 panel', async () => {
  const {result, errors} = await runMobileCdpTest({name:'kha43-reception',cdpPort:9389,run:async ({send,sessionId,navigate,evaluate,setViewport,click,waitFor}) => {
    await send('Network.enable',{},sessionId);
    await send('Network.setBlockedURLs',{urls:['https://*.supabase.co/*','https://bo.nimr.com.tn/*']},sessionId);
    await navigate('?kha43-local');
    await evaluate(technicianFixtureExpression({role:'reception',started:false}));
    await evaluate(`state.cases=[]; state.bookings=[]; invalidateUiRuntimeIndexes(); render(); document.querySelector('[data-tab="today"]').click(); document.querySelector('[data-tab="reception-workspace"]').click(); render();`);
    assert.deepEqual(await evaluate(`({tab:activeTab, cockpit:document.querySelector('#reception-today-cockpit').getBoundingClientRect().width>0, panelHidden:document.querySelector('#reception-new-entry-panel').hidden, importWidth:document.querySelector('#quick-estimate-file-input').getBoundingClientRect().width, dialogOpen:document.querySelector('#reception-new-entry-dialog').open})`), {tab:'reception-workspace', cockpit:true, panelHidden:true, importWidth:0, dialogOpen:false});
    await evaluate(`setReceptionUpstreamAppointments({result:[{id:'test-appointment',date:new Date().toISOString(),status:'confirmed',intervention:{id:'test-intervention',km:1234,description:'Diagnostic test',vehicle:{chassisNumber:'TESTVIN1234567890',registrationNumber:'TEST123',client:{firstName:'Client',lastName:'Test',phones:[{number:'22000000'}]}}}}]});`);
    assert.equal(await evaluate('state.cases.length'),0);
    await click('#reception-new-entry-btn');
    await waitFor(`document.querySelector('#reception-new-entry-dialog')?.open`,'new entry chooser');
    assert.equal(await evaluate(`document.querySelectorAll('#reception-new-entry-dialog [data-reception-entry]').length`),4);
    await click('#reception-new-entry-dialog [data-reception-entry="walk-in"]');
    assert.equal(await evaluate(`document.querySelector('#reception-new-entry-panel')?.hidden`),false);
    await waitFor(`document.querySelector('#reception-new-entry-panel .minimal-case-entry')?.open`,'walk-in form open');
    await click('#reception-new-entry-panel-close');
    await evaluate('render()');
    assert.equal(await evaluate(`document.querySelector('#reception-new-entry-panel').hidden`),true);
    const widths=[];
    for (const width of [1440,1024,768,390]) {
      await setViewport({width,height:900});
      const layout=await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,visible:document.querySelector('#reception-case-list [data-rdv-index]').getBoundingClientRect().width>0,counters:document.querySelectorAll('#reception-today-counters button').length})`);
      assert.equal(layout.width,width); assert.equal(layout.overflow,false); assert.equal(layout.visible,true); assert.equal(layout.counters,4);
      widths.push(width);
    }
    await click('#reception-case-list [data-rdv-index]');
    await waitFor(`document.querySelector('#operational-case-dialog')?.open`,'existing Reception panel');
    assert.equal(await evaluate('state.cases.length'),1);
    assert.equal(await evaluate('state.cases[0].appointment'),null);
    assert.equal(await evaluate(`Boolean(document.querySelector('#operational-case-dialog .section-action-reception'))`),true);
    assert.equal(await evaluate(`Boolean(document.querySelector('#operational-case-dialog [data-client-followup]'))`),true);
    assert.equal(await evaluate(`document.querySelectorAll('#operational-case-dialog [data-tech-action]').length`),0);
    await click('#operational-case-dialog [data-close]');
    await click('#reception-case-list [data-rdv-index]');
    assert.equal(await evaluate('state.cases.length'),1);
    return widths;
  }});
  assert.deepEqual(result,[1440,1024,768,390]);
  assert.deepEqual(errors,[]);
});

