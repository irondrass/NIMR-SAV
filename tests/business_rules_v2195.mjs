import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const scriptFiles=['js/utils.js','js/state.js','js/ui-cases.js','js/estimate-import.js','js/ui-planning.js','js/photos.js','js/storage.js','js/planning.js','js/exports.js','app.js','js/business-rules-v2187.js'];
const source=scriptFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n').replace(/initApp\(\);/,'// skip').replace(/if \("serviceWorker" in navigator[\s\S]*$/u,'');
const stub=()=>({value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},addEventListener(){},append(){},appendChild(){},replaceChildren(){},querySelector:()=>stub(),querySelectorAll:()=>[]});
const ctx={console,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},document:{querySelector:()=>stub(),querySelectorAll:()=>[],addEventListener(){},createElement:()=>stub(),getElementById:()=>stub(),body:stub()},window:{addEventListener(){}},navigator:{},fetch:async()=>({ok:false}),setTimeout,clearTimeout,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},FileReader:class{},crypto:{randomUUID:()=>`id-${Math.random()}`}};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(source,ctx);
const devis1076=`No. Désignation Qté Prix unitaire Montant
ART20/1359 OPTIQUE DE PHARE DR LED 1 1 048,315 1 048,315
ART20/1375 ELARGISSEUR D'AILE AV GH 1 78,811 78,811
ART20/1378 ELARGISSEUR D'AILE AR DR 1 55,295 55,295
ART20/1403 RÉTROVISEUR ÉLECTRIQUE DR 1 300,985 300,985
MO-002067 PRODUIT DE PEINTURE 6 180,000 1 080,000
MO-TOL PEINTURE ET FINITION CACHE RETRO DR 1 35,000 35,000
MO-TOL CHANG RÉTROVISEUR ÉLECTRIQUE DR 2 35,000 70,000
MO-TOL CHANG ELARGISSEUR D'AILE AV GH 0,5 35,000 17,500
MO-TOL CHANG ELARGISSEUR D'AILE AR DR 0,5 35,000 17,500
MO-TOL CHANG OPTIQUE DE PHARE DR LED 0,5 35,000 17,500
MO-TOL D/P ET PREPARATION PARE-CHOCS AV COMPLET 2 35,000 70,000
MO-TOL PEINTURE ET FINITION PARE-CHOCS AV COMPLET 4 35,000 140,000
MO-TOL DRESSAGE ET PEINTURE CAPOT 8 35,000 280,000
MO-TOL D/P ET PREPARATION AILE AV DR 2 35,000 70,000
MO-TOL PEINTURE ET FINITION AILE AV DR 4 35,000 140,000
MO-TOL DRESSAGE ET PEINTURE AILE AR DR 8 35,000 280,000
MO-TOL DRESSAGE ET PEINTURE PORTE AR DR 12 35,000 420,000
MO-TOL DRESSAGE ET PEINTURE PORTE AV DR 8 35,000 280,000
MO-TOL CHANG CALANDRE 0,5 35,000 17,500`;
const parsed=ctx.parseEstimateText(devis1076,{fileName:'1076.pdf',claimType:'assurance'});
const original=ctx.buildOriginalEstimateLines(parsed);
assert.equal(original.length,14,'1076 doit importer exactement les 14 lignes MO-TOL/MO-MEC');
assert.equal(original.some(l=>/PRODUIT DE PEINTURE/i.test(l.operation)),false,'MO-002067 produit peinture doit être ignoré');
assert.equal(Math.round(original.reduce((s,l)=>s+Number(l.laborHours||0),0)*100)/100,53,'total MO devis doit rester 53 h');
const dirty={estimate:{originalLines:[...original,{id:'x',code:'MO-002067',operation:'PRODUIT DE PEINTURE',laborHours:6},{id:'y',operation:'PEINTURE ET FINITION CACHE RETRO',laborHours:1,allocations:[{phase:'prep',laborHours:.5},{phase:'paint',laborHours:.5}]}]}};
ctx.cleanClaimEstimateForPlanning(dirty);
assert.equal(dirty.estimate.originalLines.length,14,'nettoyage doit supprimer produit peinture et doublon générique');
assert.equal(dirty.estimate.totalOriginalHours,53);
console.log('business v21.95 1076 OK');
