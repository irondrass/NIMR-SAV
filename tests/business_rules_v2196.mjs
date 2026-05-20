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
const devisWithPdfArtifacts=`
MO-TOL PEINTURE ET FINITION CACHE RETRO DR 1 35,000 35,000
MO-TOL CHANG RÉTROVISEUR ÉLECTRIQUE DR 2 35,000 70,000
MO-TOL CHANG ELARGISSEUR D'AILE AV GH 0,5 35,000 17,500
MO-TOL CHANG ELARGISSEUR D'AILE AR DR 0,5 35,000 17,500
MO-TOL CHANG OPTIQUE DE PHARE DR LED 0,5 35,000 17,500
MO-TOL D/P ET PREPARATION PARE-CHOCS AV 2 35,000 70,000
MO-TOL PEINTURE ET FINITION PARE-CHOCS AV 4 35,000 140,000
MO-TOL DRESSAGE ET PEINTURE CAPOT 8 35,000 280,000
MO-TOL D/P ET PREPARATION AILE AV DR 2 35,000 70,000
MO-TOL PEINTURE ET FINITION AILE AV DR 4 35,000 140,000
MO-TOL DRESSAGE ET PEINTURE AILE AR DR 8 35,000 280,000
MO-TOL DRESSAGE ET PEINTURE PORTE AR DR 12 35,000 420,000
MO-TOL DRESSAGE ET PEINTURE PORTE AV DR 8 35,000 280,000
MO-TOL CHANG CALANDRE 0,5 35,000 17,500
No. Désignation Qté Prix unitaire Montant Report 4 287,035 MO-TOL CHANG OPTIQUE DE PHARE DR LED 0,5 35,000 17,500
MO-TOL D/P ET PREPARATION PARE-CHOCS AV COMPLET 2 35,000 70,000
MO-TOL PEINTURE ET FINITION PARE-CHOCS AV COMPLET 4 35,000 140,000`;
const parsed=ctx.parseEstimateText(devisWithPdfArtifacts,{fileName:'1076-artifacts.pdf',claimType:'assurance'});
const original=ctx.buildOriginalEstimateLines(parsed);
assert.equal(original.length,14,'les artefacts PDF et doublons COMPLET ne doivent pas créer 17 lignes');
assert.equal(original.some(l=>/^No\. Désignation/i.test(l.operation)),false,'le préfixe tableau/report ne doit jamais devenir une opération MO');
assert.equal(original.filter(l=>/OPTIQUE DE PHARE DR LED/i.test(l.operation)).length,1,'CHANG OPTIQUE doit rester une seule fois');
assert.equal(original.filter(l=>/PARE-CHOCS AV/i.test(l.operation) && /PREPARATION/i.test(l.operation)).length,1,'D/P pare-chocs doit rester une seule fois');
assert.equal(original.filter(l=>/PEINTURE ET FINITION PARE-CHOCS AV/i.test(l.operation)).length,1,'Peinture pare-chocs doit rester une seule fois');
assert.equal(Math.round(original.reduce((s,l)=>s+Number(l.laborHours||0),0)*100)/100,53,'total final doit rester 53 h');
console.log('business v21.96 PDF artifact dedupe OK');
