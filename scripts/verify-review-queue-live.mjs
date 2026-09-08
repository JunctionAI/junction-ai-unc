// One internal queued revision. Run after compiling the worker, using env injection.
// Not a persistent daemon or a test of Slack/Grok. No client account override.
import {createClient} from '@supabase/supabase-js';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const accountId='55a377a5-c12e-4de6-a085-0d9a50ccd488';
const outputId='b4e4f38c-94a2-4bd9-88d5-e0c9faedcc11';
const artifactId='f47ede89-947a-47e0-9e72-cfc42d9699ee';
const actor='7371b18c-55a3-4b40-8231-33035e506b80';
// Fixed comment identity lets an uncertain save be reconciled, not duplicated.
const commentId='c16815a9-ab88-448c-b9ec-47afec5b5511';
assert.equal(process.env.REVIEW_QUEUE_TEST_GO,commentId);
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'ycgayfsvcjpsnryrpukv.supabase.co');
assert.equal(new URL(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').hostname,'api.openai.com');
assert.ok(process.env.OPENAI_API_KEY);
Object.assign(process.env,{JUNCTION_REVIEW_ENABLED:'true',JUNCTION_REVIEW_ACCOUNT_IDS:accountId,JUNCTION_REVIEW_TEXT_QUEUE_ENABLED:'true',LLM_MODEL_ROUTINE_PRODUCE:'gpt-5-mini'});
const require=createRequire(import.meta.url);
const {runReviewQueueTick}=require('../dist/worker/worker/reviewQueue.js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function checked(query){const r=await query;if(r.error)throw new Error(`Database refused (${r.error.code||'unknown'})`);return r.data;}
const account=await checked(db.from('accounts').select('name,automation_paused,context_generation,monthly_llm_cap_usd').eq('id',accountId).single());
assert.equal(account.name,'Junction TEST — Review sandbox');assert.equal(account.automation_paused,true);assert.equal(account.context_generation,0);assert.equal(Number(account.monthly_llm_cap_usd),0);
for(const table of ['connectors','routine_states','account_model_prefs'])assert.equal((await checked(db.from(table).select('account_id').eq('account_id',accountId).limit(1))).length,0);
const before=await checked(db.rpc('read_review_output',{acct:accountId,generation:0,actor,output:outputId}));
assert.equal(before.output.revision,1);assert.equal(before.output.kind,'brief');
const priorUsage=await checked(db.from('llm_usage').select('id').eq('account_id',accountId));
assert.equal(priorUsage.length,1,'Reconcile prior usage before another test');
const priorJobs=await checked(db.from('review_revision_jobs').select('id,status').eq('account_id',accountId).in('status',['queued','running']));
assert.equal(priorJobs.length,0,'Reconcile existing jobs before another test');
const saved=await checked(db.rpc('add_review_comment',{acct:accountId,generation:0,actor,artifact:artifactId,output:outputId,expected_revision:1,comment:commentId,anchor_value:{kind:'whole'},note_value:'Make this conversational and concise, maximum 30 words. Keep the fact that this is an internal test and nothing is sent or published. Do not invent new capabilities.',intent_value:'change_output'}));
assert.equal(saved.commentId,commentId);assert.ok(saved.jobId);assert.equal(saved.duplicate,false);
console.log(JSON.stringify({stage:'queued',jobId:saved.jobId,commentId,outputId}));
assert.equal((await runReviewQueueTick(db)).status,'idle','Paused account must not dispatch');
let opened=false;
try{
 opened=true;
 const rows=await checked(db.from('accounts').update({automation_paused:false,monthly_llm_cap_usd:0.05}).eq('id',accountId).eq('context_generation',0).eq('automation_paused',true).eq('monthly_llm_cap_usd',0).select('id'));
 assert.equal(rows.length,1);
 const result=await runReviewQueueTick(db);
 console.log(JSON.stringify({stage:'queue_result',result}));
 assert.equal(result.status,'processed');assert.equal(result.jobId,saved.jobId);assert.equal(result.outcome.status,'done');
 assert.equal((await runReviewQueueTick(db)).status,'idle','Completed job must not dispatch again');
 const current=await checked(db.rpc('read_review_output',{acct:accountId,generation:0,actor,output:outputId}));
 assert.equal(current.output.revision,2);
 assert.ok(current.version.content.body.trim().split(/\s+/).length<=30);
 const retained=await checked(db.from('review_output_versions').select('content').eq('output_id',outputId).eq('revision',1).single());
 assert.deepEqual(retained.content,before.version.content);
 const allUsage=await checked(db.from('llm_usage').select('id,provider,model,input_tokens,output_tokens,est_cost_usd,stop_reason').eq('account_id',accountId));
 const usage=allUsage.filter(u=>!priorUsage.some(p=>p.id===u.id));
 assert.equal(usage.length,1);assert.equal(usage[0].model,'gpt-5-mini');
 console.log(JSON.stringify({status:'PASS',scope:'one real queue-selected text revision, paused refusal and idle duplicate prevention; not persistent daemon, media, Grok, Slack or provider action',outputId,jobId:saved.jobId,content:current.version.content,usage}));
}finally{
 if(opened){
  await checked(db.from('accounts').update({automation_paused:true,monthly_llm_cap_usd:0}).eq('id',accountId));
  const restored=await checked(db.from('accounts').select('automation_paused,monthly_llm_cap_usd').eq('id',accountId).single());
  assert.equal(restored.automation_paused,true);assert.equal(Number(restored.monthly_llm_cap_usd),0);
  console.log(JSON.stringify({stage:'restored',accountId,paused:true,capUsd:0}));
 }
}
