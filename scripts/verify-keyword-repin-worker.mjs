/** Release-specific check: no activation, provider execution or accepted issuance. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),expected=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(expected??''))throw Error('Exact expected source required');
const source=`let stage='build';const finish=r=>process.stdout.write(JSON.stringify(r)+'\\n',()=>process.exit(r.status==='PASS'?0:1));const timer=setTimeout(()=>finish({status:'FAIL',stage}),20000);(async()=>{
  const assert=require('node:assert/strict');assert.equal(process.env.UNC_BUILD_SHA,${JSON.stringify(expected)});
  for(const k of ['UNC_COMMANDS_ENABLED','UNC_MESSAGING_ENABLED','LIVE_MODE_ENABLED','TNZ_SMS_ENABLED','APPLE_MESSAGES_ENABLED'])assert.equal(process.env[k],'false');
  const {KEYWORD_PILOT_PIN}=require('/app/dist/worker/lib/n8n/keywordAdmission.js');assert.equal(KEYWORD_PILOT_PIN.workflowVersion,'ac771cd3-8899-4401-915c-40d4477e48e2');
  const db=require('/app/dist/worker/worker/wiring.js').serviceDb();assert.ok(db);
  const accountId='aa5cfc84-2569-4c99-9b40-67003ae55eda',actorId='74802c60-149a-4405-b719-dc058d174072';
  stage='account';const a=await db.from('accounts').select('context_generation,automation_paused').eq('id',accountId).single();assert.equal(a.error,null);assert.equal(a.data.context_generation,1);assert.equal(a.data.automation_paused,true);
  const input={accountId,actorId,contextGeneration:1,operation:'read'};
  stage='configuration';const c=await db.rpc('keyword_customer_configuration',{input});assert.equal(c.error,null);assert.equal(c.data.enabled,false);assert.equal(c.data.paused,true);assert.deepEqual(c.data.candidates,[]);
  assert.equal(c.data.spec.nodes[3].shadowContract.workflowVersion,'92135add-3c35-43e4-9649-5bb3d4557814');
  const view=require('/app/dist/worker/lib/n8n/keywordConfiguration.js').readKeywordConfiguration(c.data,input).view;
  assert.equal(view.market,null);assert.equal(view.released,false);
  stage='stale-context';const started=Date.now();const stale=await db.rpc('keyword_customer_configuration',{input:{...input,contextGeneration:2}});assert.equal(stale.error?.code,'PT409');assert.equal(stale.status,409);const refusalMs=Date.now()-started;assert.ok(refusalMs<5000);
  stage='paused-issuance';const refusal=await db.rpc('issue_keyword_shadow_pilot',{input:{run:{id:'00000000-0000-4000-8000-000000000001',accountId,contextGeneration:1},receiverUrl:KEYWORD_PILOT_PIN.receiverUrl,approval:{authorizedBy:actorId,approvalReference:'release-refusal-check',idempotencyKey:'release-refusal-check',market:'US',contextGeneration:1,maxProviderCalls:1,expiresAt:new Date(Date.now()+60000).toISOString()}}});assert.equal(refusal.error?.code,'PT409');assert.equal(refusal.status,409);
  stage='history';const p=await db.from('n8n_shadow_permits').select('id,status,contract,execution_id').eq('account_id',accountId);assert.equal(p.error,null);assert.equal(p.data.length,4);assert.ok(p.data.every(r=>r.status==='verified'&&r.contract.workflowVersion==='92135add-3c35-43e4-9649-5bb3d4557814'));
  clearTimeout(timer);finish({status:'PASS',checkedAt:new Date().toISOString(),source:process.env.UNC_BUILD_SHA,revision:KEYWORD_PILOT_PIN.workflowVersion,oldHistoryPreserved:true,newRevisionHasNoLiveProof:true,customerSelectionReleased:false,pausedIssuanceRefused:true,staleContextConflictMs:refusalMs,databaseCalls:5,providerCalls:0,n8nCalls:0,writes:0});
})().catch(()=>{clearTimeout(timer);finish({status:'FAIL',stage});});`;
try {
  const r=await exec('/Users/tomhall-taylor/.fly/bin/flyctl',['ssh','console','-a','unc-worker','--machine','1857466fd76998','--quiet','-C',`node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`],{timeout:30000,maxBuffer:1048576});
  console.log(JSON.stringify(JSON.parse(r.stdout.trim()),null,2));
}catch(error){let stage='transport';try{const r=JSON.parse(error?.stdout?.trim());stage=String(r.stage).replace(/[^a-z-]/g,'').slice(0,40);}catch{/* Suppress raw errors. */}console.error(JSON.stringify({status:'FAIL',stage}));process.exitCode=1;}
