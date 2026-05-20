import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const scriptFiles=['js/state.js','js/ui-cases.js','js/estimate-import.js','js/ui-planning.js','js/photos.js','js/storage.js','js/planning.js','js/exports.js','js/utils.js','app.js','js/business-rules-v2187.js'];
const source=scriptFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n').replace(/initApp\(\);/,'// skip').replace(/if \("serviceWorker" in navigator[\s\S]*$/u,'');
const stub=()=>({value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},addEventListener(){},append(){},appendChild(){},replaceChildren(){},querySelector:()=>stub(),querySelectorAll:()=>[]});
const ctx={console,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},document:{querySelector:()=>stub(),querySelectorAll:()=>[],addEventListener(){},createElement:()=>stub(),getElementById:()=>stub(),body:stub()},window:{addEventListener(){}},navigator:{},fetch:async()=>({ok:false}),setTimeout,clearTimeout,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},FileReader:class{},crypto:{randomUUID:()=>`id-${Math.random()}`}};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(source,ctx);
const preview={laborLines:[
 {operation:'PEINTURE ET FINITION CACHE RETRO',text:'MO-001 PEINTURE ET FINITION CACHE RETRO 1 33,000 33,000',hours:1,distributions:[{phase:'prep',operation:'PREP',laborHours:0.5},{phase:'paint',operation:'PAINT',laborHours:0.5}]},
 {operation:'PEINTURE ET FINITION CACHE RETRO DR',text:'MO-001 PEINTURE ET FINITION CACHE RETRO DR 1 33,000 33,000',hours:1,distributions:[{phase:'prep',operation:'PREP DR',laborHours:0.5},{phase:'paint',operation:'PAINT DR',laborHours:0.5}]},
]};
const original=ctx.buildOriginalEstimateLines(preview);
assert.equal(original.length,1,'generic duplicate should be removed');
assert.equal(original[0].operation.includes('DR'),true);
assert.ok(Math.abs(original[0].allocations[0].laborHours - 0.666667) < 0.00001);
assert.ok(Math.abs(original[0].allocations[1].laborHours - 0.333333) < 0.00001);
const applied=ctx.buildAppliedEstimateLines({...preview, originalLines: original});
const quality=applied.find(l=>l.phase==='quality');
assert.equal(quality.laborHours,0.25);
const finish=applied.find(l=>l.phase==='finish');
assert.ok(Math.abs(finish.laborHours - 0.166667) < 0.00001);
console.log('business v21.94 custom OK', original, applied.map(l=>[l.phase,l.laborHours]));
