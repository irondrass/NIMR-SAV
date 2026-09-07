import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('../apps/nimr-sav-react/node_modules/typescript');
const edge=fs.readFileSync(new URL('../supabase/functions/workshop-user-admin/index.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(edge.replace(/^import .*createClient.*;$/m,'const createClient = () => { throw new Error("Use the fixture client"); };'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.deepEqual(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
const sandbox={exports:{},Request,Response,Headers,URL,console};
vm.runInNewContext(compiled.outputText,sandbox);
const factory=sandbox.exports.createWorkshopUserAdminHandler;

async function scenario(options={}) {
  const members=[
    {user_id:'admin',workshop_id:'atelier',role:options.role||'admin_technique',resource_id:null,deleted_at:null},
    {user_id:'tech',workshop_id:options.targetWorkshop||'atelier',role:options.targetRole||'technicien',resource_id:options.currentResource||null,deleted_at:null},
    ...(options.occupied ? [{user_id:'other',workshop_id:'atelier',role:'technicien',resource_id:'tolier',deleted_at:null}] : [])
  ];
  const resources=[{id:'tolier',workshop_id:options.resourceWorkshop||'atelier',type:options.resourceType||'tolier',active:options.active!==false,deleted_at:null}];
  let writes=0, invited=0;
  class Query {
    constructor(table){this.table=table;this.filters=[];this.patch=null;}
    select(){return this;} order(){return this;} limit(){return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    is(key,value){this.filters.push(row=>value===null ? row[key]==null : row[key]===value);return this;}
    update(patch){this.patch=patch;return this;}
    then(resolve,reject){return this.execute(false).then(resolve,reject);}
    maybeSingle(){return this.execute(true);}
    async execute(single){
      if(this.patch && options.concurrentChange) members[1].resource_id='another';
      const store=this.table==='workshop_members' ? members : resources;
      const rows=store.filter(row=>this.filters.every(check=>check(row)));
      if(this.patch){writes+=rows.length;rows.forEach(row=>Object.assign(row,this.patch));}
      return {data:single ? (rows[0]||null) : rows.map(row=>({...row})),error:null};
    }
  }
  const adminClient={from:table=>new Query(table),auth:{admin:{inviteUserByEmail:()=>{invited++;throw new Error('No invitation expected');}}}};
  const userClient={auth:{getUser:async()=>({data:{user:options.invalidSession ? null : {id:'admin'}},error:null})}};
  const handler=factory({environment:{get:name=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'private-test'})[name]},
    clientFactory:(_url,key)=>key==='public-test' ? userClient : adminClient});
  const response=await handler(new Request('https://example.test/function',{method:'POST',headers:{Authorization:'Bearer test-session','Content-Type':'application/json'},
    body:JSON.stringify({action:'link_technician_resource',user_id:'tech',workshop_id:'atelier',resource_id:options.requestResource===undefined?'tolier':options.requestResource,
      expected_resource_id:options.expectedResource===undefined?(options.currentResource||null):options.expectedResource})}));
  return {status:response.status,body:await response.json(),members,writes,invited};
}
for(const role of ['admin_technique','directeur']) test(`${role} links the existing technician without creating a user`,async()=>{
  const result=await scenario({role});
  assert.equal(result.body.ok,true);assert.equal(result.members[1].resource_id,'tolier');
  assert.equal(result.members[1].role,'technicien');assert.equal(result.members.length,2);
  assert.equal(result.writes,1);assert.equal(result.invited,0);
});
for(const role of ['chef_atelier','reception','technicien','controle_qualite','lecture_seule']) test(`${role} cannot change the link`,async()=>{
  const result=await scenario({role});assert.equal(result.body.ok,false);assert.equal(result.writes,0);
});
for(const [name,options] of [
  ['expired session',{invalidSession:true}],['another workshop member',{targetWorkshop:'other'}],
  ['another workshop resource',{resourceWorkshop:'other'}],['equipment',{resourceType:'cabine'}],
  ['inactive resource',{active:false}],['occupied resource',{occupied:true}],
  ['missing resource',{requestResource:''}],['non-technician target',{targetRole:'directeur'}],
  ['stale displayed link',{currentResource:'old',expectedResource:null}],['concurrent reassignment',{concurrentChange:true}]
]) test(`rejects ${name} without writing`,async()=>{
  const result=await scenario(options);assert.equal(result.body.ok,false);assert.equal(result.writes,0);assert.equal(result.invited,0);
});
test('retrying the same confirmed link is idempotent',async()=>{
  const result=await scenario({currentResource:'tolier'});assert.equal(result.body.ok,true);assert.equal(result.writes,0);
});
