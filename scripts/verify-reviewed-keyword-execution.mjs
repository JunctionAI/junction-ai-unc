/** Independently compare a named saved execution with its original Unc result.
 * GET/read RPC only; secrets and raw webhook inputs remain on the worker. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const [runId, executionId, market] = process.argv.slice(2);
if (process.argv.length !== 5 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId ?? '') ||
    !/^[1-9]\d{0,29}$/.test(executionId ?? '') || !['US','NZ','AU'].includes(market)) throw Error('Exact run, execution and market required');
async function verify(runId, executionId, market) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const assert = require('node:assert/strict'), crypto = require('node:crypto');
  const load = require; // Serialized into the actual CommonJS worker.
  const accountId='aa5cfc84-2569-4c99-9b40-67003ae55eda', workflowId='XiXJKuph1fAeH9pe';
  const revision='ac771cd3-8899-4401-915c-40d4477e48e2', location={US:2840,NZ:2554,AU:2036}[market];
  assert.equal(process.env.UNC_BUILD_SHA,'aa3fba419a1cbb8d5a1d4c27dbb363bc3626f92a');
  for (const flag of ['UNC_COMMANDS_ENABLED','UNC_MESSAGING_ENABLED','LIVE_MODE_ENABLED','TNZ_SMS_ENABLED','APPLE_MESSAGES_ENABLED']) assert.equal(process.env[flag],'false');
  const db=load('/app/dist/worker/worker/wiring.js').serviceDb(); assert.ok(db);
  const read=async query=>{const r=await query;assert.equal(r.error,null);return r.data;};
  const account=await read(db.from('accounts').select('context_generation,automation_paused').eq('id',accountId).single());
  assert.equal(account.context_generation,1);assert.equal(account.automation_paused,true);
  const permit=await read(db.from('n8n_shadow_permits').select('id,status,contract,request_digest,execution_id').eq('account_id',accountId).eq('run_id',runId).single());
  assert.equal(permit.status,'verified');assert.equal(permit.execution_id,executionId);assert.equal(permit.contract.workflowVersion,revision);
  assert.equal(permit.contract.client.locationCode,location);assert.equal(permit.contract.client.seedKeyword,'golf travel bag');
  const run=await read(db.from('routine_runs').select('id,status,mode,context_generation').eq('account_id',accountId).eq('id',runId).single());
  assert.equal(run.status,'done');assert.equal(run.mode,'dry_run');assert.equal(run.context_generation,1);
  const artifact=await read(db.from('artifacts').select('id,kind,title,body,items,evidence,meta').eq('account_id',accountId).eq('run_id',runId).single());
  const receipts=await read(db.from('receipts').select('id,kind').eq('account_id',accountId).eq('run_id',runId));
  assert.equal(receipts.length,5);assert.ok(receipts.every(r=>r.kind!=='mutation'));
  const api='https://junctionai8.app.n8n.cloud/api/v1';assert.equal(process.env.N8N_EXECUTION_API_BASE_URL,api);
  const response=await fetch(api+'/executions/'+executionId+'?includeData=true',{method:'GET',redirect:'error',cache:'no-store',
    headers:{accept:'application/json','X-N8N-API-KEY':process.env.N8N_EXECUTION_API_KEY},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);let size=0;const chunks=[];
  for await(const part of response.body){size+=part.length;assert.ok(size<=1048576);chunks.push(Buffer.from(part));}
  const saved=JSON.parse(Buffer.concat(chunks).toString());
  const observation=load('/app/dist/worker/lib/n8n/executionEvidence.js').projectShadowExecution(saved,{workflowId,executionId,triggerNodeId:'c934c229-1191-43b7-b035-5fc641fbe0d0'});
  assert.equal(observation.workflowVersion,revision);assert.equal(observation.request.accountId,accountId);
  assert.equal(observation.request.runId,runId);assert.equal(observation.request.routineId,'D03-W01');assert.equal(observation.requestDigest,permit.request_digest);
  const builder=saved.workflowData.nodes.filter(n=>n.id==='af132442-1901-466e-a3d1-84750e50abdd');assert.equal(builder.length,1);
  assert.equal(crypto.createHash('sha256').update(builder[0].parameters.jsCode.replace(/\r\n/g,'\n').trim()).digest('hex'),'8668beead72a6d83862039f40a07ea76f42dc24244a52b6644870cbfbc0bf497');
  const steps=saved.data.resultData.runData[builder[0].name];assert.equal(steps.length,1);assert.equal(steps[0].executionStatus,'success');
  const outputs=steps[0].data.main;assert.equal(outputs.length,1);assert.equal(outputs[0].length,1);
  const output=outputs[0][0].json;assert.equal(output.http_status,200);
  const parsed=load('/app/dist/worker/lib/artifacts/validate.js').validateArtifactObject(output.payload.artifact,{kind:'keyword_list',maxItems:15,allowedNumbers:null});assert.equal(parsed.ok,true);
  for(const field of ['kind','title','body','items'])assert.deepEqual(artifact[field],parsed.artifact[field]);
  assert.deepEqual(artifact.evidence.filter(e=>e.source!=='n8n_execution'),parsed.artifact.evidence);
  assert.ok(artifact.evidence.some(e=>e.source==='n8n_execution'&&e.ref.endsWith('/executions/'+executionId)));
  const original=output.payload.executionReceipt, receipt=artifact.meta.executionReceipt;
  assert.equal(original.workflowVersion,null);assert.equal(original.revisionEvidence,'pending_unc_verification');
  for(const field of ['accountId','runId','routineId','workflowId','executionId','mode','status','executedAction','startedAt','finishedAt','client'])assert.deepEqual(receipt[field],original[field]);
  for(const field of ['name','taskId','statusCode','taskStatusCode','itemsCount','fetchedAt'])assert.deepEqual(receipt.provider[field],original.provider[field]);
  assert.equal(receipt.workflowVersion,revision);assert.equal(receipt.revisionEvidence,'verified_execution_record');assert.equal(receipt.executedAction,'none');
  assert.equal(receipt.revisionVerification.requestDigest,observation.requestDigest);assert.equal(receipt.revisionVerification.source,'n8n_execution_record');
  assert.equal(artifact.items.length,1);const item=artifact.items[0].meta;
  assert.equal(item.location_code,location);assert.equal(item.target_page,null);assert.equal(item.priority,null);assert.equal(item.prioritization,'pending');
  assert.equal(item.provider_stats.competition_is_paid_search,true);assert.equal(typeof item.provider_stats.keyword_difficulty,'number');
  const config=await read(db.rpc('keyword_customer_configuration',{input:{accountId,actorId:'74802c60-149a-4405-b719-dc058d174072',contextGeneration:1,operation:'read'}}));
  assert.ok(config.candidates.some(c=>c.market===market&&c.sourceRunId===runId));assert.equal(config.enabled,false);
  return {status:'PASS',checkedAt:new Date().toISOString(),market,location,runId,permitId:permit.id,executionId,artifactId:artifact.id,revision,
    savedExecutionMatchesArtifact:true,requestDigest:observation.requestDigest,providerTaskId:receipt.provider.taskId,
    providerStats:item.provider_stats,providerTimestamps:item.provider_timestamps,priorityPending:true,receiptCount:receipts.length,
    eligibleMarkets:config.candidates.map(c=>c.market),paused:true,databaseReads:6,n8nReads:1,providerCalls:0,writes:0};
}
const source=`const finish=r=>process.stdout.write(JSON.stringify(r)+'\\n',()=>process.exit(r.status==='PASS'?0:1));const t=setTimeout(()=>finish({status:'FAIL',stage:'timeout'}),30000);(${verify.toString()})(${JSON.stringify(runId)},${JSON.stringify(executionId)},${JSON.stringify(market)}).then(r=>{clearTimeout(t);finish(r);}).catch(()=>{clearTimeout(t);finish({status:'FAIL',stage:'read-or-assertion'});});`;
try {
  const r=await promisify(execFile)('/Users/tomhall-taylor/.fly/bin/flyctl',['ssh','console','-a','unc-worker','--machine','1857466fd76998','--quiet','-C',`node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`],{timeout:40000,maxBuffer:1048576});
  console.log(JSON.stringify(JSON.parse(r.stdout.trim()),null,2));
}catch{console.error(JSON.stringify({status:'FAIL',stage:'read-or-assertion',runId,executionId,providerCalls:0,writes:0}));process.exitCode=1;}
