// One explicitly named internal test job. Never accepts a client/account override.
// Compile worker first. Run via Vercel env run; secrets are neither printed nor saved.
import {createClient} from '@supabase/supabase-js';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const accountId='55a377a5-c12e-4de6-a085-0d9a50ccd488';
const jobId='3e8d9990-9e02-4115-a308-313b5888c99f';
const outputId='b4e4f38c-94a2-4bd9-88d5-e0c9faedcc11';
const actor='7371b18c-55a3-4b40-8231-33035e506b80';
if(process.env.REVIEW_TEXT_TEST_GO!==jobId)throw new Error('Explicit pilot job confirmation required');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname,'ycgayfsvcjpsnryrpukv.supabase.co');
assert.ok(process.env.OPENAI_API_KEY);
assert.equal(new URL(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').hostname,'api.openai.com');
process.env.JUNCTION_REVIEW_ENABLED='true';process.env.JUNCTION_REVIEW_ACCOUNT_IDS=accountId;
process.env.LLM_MODEL_ROUTINE_PRODUCE='gpt-5-mini';
const {runTextReviewJob}=require('../dist/worker/worker/runReviewRevision.js');
const {resolveModel}=require('../dist/worker/lib/llm/router.js');
assert.equal(resolveModel('routine_produce')?.id,'gpt-5-mini');
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function checked(query){const r=await query;if(r.error)throw new Error(`Database operation refused (${r.error.code||'unknown'})`);return r.data;}
const account=await checked(db.from('accounts').select('name,automation_paused,context_generation,monthly_llm_cap_usd').eq('id',accountId).single());
assert.equal(account.name,'Junction TEST — Review sandbox');assert.equal(account.automation_paused,true);
assert.equal(account.context_generation,0);assert.equal(Number(account.monthly_llm_cap_usd),0);
for(const table of ['connectors','routine_states','account_model_prefs','llm_usage'])
 assert.equal((await checked(db.from(table).select('*').eq('account_id',accountId).limit(1))).length,0,`Unexpected ${table}; reconcile before rerun`);
const job=await checked(db.from('review_revision_jobs').select('status,output_id,base_revision').eq('id',jobId).eq('account_id',accountId).single());
assert.equal(job.status,'queued');assert.equal(job.output_id,outputId);assert.equal(job.base_revision,0);
const original=await checked(db.rpc('read_review_output',{acct:accountId,generation:0,actor,output:outputId}));
assert.equal(original.output.revision,0);assert.equal(original.output.kind,'brief');
let opened=false;
try{
 // Restore even if the update response is lost after the database commits it.
 opened=true;
 const rows=await checked(db.from('accounts').update({automation_paused:false,monthly_llm_cap_usd:0.05})
  .eq('id',accountId).eq('context_generation',0).eq('automation_paused',true).eq('monthly_llm_cap_usd',0).select('id'));
 assert.equal(rows.length,1);
 const result=await runTextReviewJob(db,{accountId,contextGeneration:0},jobId);
 console.log(JSON.stringify({stage:'revision_result',accountId,jobId,result}));
 const current=await checked(db.rpc('read_review_output',{acct:accountId,generation:0,actor,output:outputId}));
 const usage=await checked(db.from('llm_usage').select('id,provider,model,input_tokens,output_tokens,est_cost_usd,stop_reason').eq('account_id',accountId));
 console.log(JSON.stringify({stage:'readback',outputId,revision:current.output.revision,content:current.version.content,usage}));
 assert.equal(result.status,'done');assert.equal(current.output.revision,1);assert.equal(usage.length,1);
 assert.equal(usage[0].model,'gpt-5-mini');assert.equal(usage[0].stop_reason,'end');
 assert.ok(current.version.content.body!==original.version.content.body);
 assert.ok(current.version.content.body.trim().split(/\s+/).length<=40);
 const retained=await checked(db.from('review_output_versions').select('content').eq('output_id',outputId).eq('revision',0).single());
 assert.deepEqual(retained.content,original.version.content);
 console.log(JSON.stringify({status:'PASS',scope:'one real internal text revision; no media generation, Grok, Slack or client execution',jobId,outputId}));
}finally{
 if(opened){
  await checked(db.from('accounts').update({automation_paused:true,monthly_llm_cap_usd:0}).eq('id',accountId));
  const restored=await checked(db.from('accounts').select('automation_paused,monthly_llm_cap_usd').eq('id',accountId).single());
  assert.equal(restored.automation_paused,true);assert.equal(Number(restored.monthly_llm_cap_usd),0);
  console.log(JSON.stringify({stage:'restored',accountId,automationPaused:true,monthlyCapUsd:0}));
 }
}
