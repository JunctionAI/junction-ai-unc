import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectKeywordPilot,remotePreflight} from '../verify-keyword-pilot-readiness.mjs';

function fixture() {
  const sha = 'a'.repeat(40), revision = 'reviewed-revision';
  const pin = {workflowId:'XiXJKuph1fAeH9pe',workflowVersion:revision,receiverUrl:'https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow'};
  const env = {UNC_BUILD_SHA:sha,N8N_DATA_BASE_URL:'https://junction-unc.vercel.app',N8N_SHADOW_RECEIVER_URL:pin.receiverUrl,
    N8N_SHADOW_RECEIVER_TOKEN:'synthetic-receiver-'.repeat(3),N8N_SIGNING_SECRET:'synthetic-signing-'.repeat(3),
    N8N_EXECUTION_READER_ENABLED:'true',N8N_EXECUTION_API_BASE_URL:'https://junctionai8.app.n8n.cloud/api/v1',
    N8N_EXECUTION_API_KEY:'synthetic-key-'.repeat(3),N8N_EXECUTION_API_KEY_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),
    N8N_SHADOW_WORKFLOW_ID:pin.workflowId,N8N_SHADOW_TRIGGER_NODE_ID:'c934c229-1191-43b7-b035-5fc641fbe0d0'};
  for (const name of ['UNC_COMMANDS_ENABLED','UNC_MESSAGING_ENABLED','LIVE_MODE_ENABLED','TNZ_SMS_ENABLED','APPLE_MESSAGES_ENABLED']) env[name]='false';
  const workflow = {id:pin.workflowId,versionId:revision,activeVersionId:revision,active:true,nodes:[{
    id:env.N8N_SHADOW_TRIGGER_NODE_ID,type:'n8n-nodes-base.webhook',parameters:{authentication:'headerAuth',httpMethod:'POST',path:'unc/d03-w01/keyword-shadow',responseMode:'responseNode',options:{ignoreBots:false}},
    credentials:{httpHeaderAuth:{id:'Y9Xu3zApLSrcWu1e'}}}]};
  const health = {ok:true,db:{ok:true},worker:{fresh:true},build:{sha:sha.slice(0,12)}};
  const account = {account:{contextGeneration:1},automationPaused:false,vars:{website:'https://avgarsport.com/'}};
  const calls = [];
  return {env,pin,workflow,health,account,calls,digest:text=>createHash('sha256').update(text).digest('hex'),
    readJson:async(url,headers)=>{calls.push({url,headers});return url.endsWith('/api/health')?health:workflow;},
    readAccount:async id=>{assert.equal(id,'aa5cfc84-2569-4c99-9b40-67003ae55eda');return account;}};
}

test('configuration PASS never claims receiver auth, provider or E2E success and projects no secrets',async()=>{
  const f=fixture(),r=await inspectKeywordPilot(f);
  assert.equal(r.status,'PASS');assert.equal(r.receiverAuthenticationProven,false);assert.equal(r.endToEndProven,false);
  assert.equal(r.providerCalls,0);assert.equal(r.permitsIssued,0);
  for(const key of ['N8N_SHADOW_RECEIVER_TOKEN','N8N_SIGNING_SECRET','N8N_EXECUTION_API_KEY']) assert.ok(!JSON.stringify(r).includes(f.env[key]));
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>!c.url.includes('/webhook/')));
});
for (const [name,change,blocker] of [
  ['ignore bots',f=>{f.workflow.nodes[0].parameters.options.ignoreBots=true;},'webhook_blocks_server_user_agents'],
  ['new published revision',f=>{f.workflow.activeVersionId='unreviewed';},'published_revision_requires_review_and_repin'],
  ['draft drift',f=>{f.workflow.versionId='draft-changed';},'published_revision_requires_review_and_repin'],
  ['wrong credential',f=>{f.workflow.nodes[0].credentials.httpHeaderAuth.id='other-tenant';},'webhook_binding_mismatch'],
  ['disabled reader',f=>{f.env.N8N_EXECUTION_READER_ENABLED='false';},'execution_reader_disabled'],
  ['paused account',f=>{f.account.automationPaused=true;},'account_paused_or_missing'],
  ['different generation',f=>{f.account.account.contextGeneration=2;},'pilot_context_mismatch'],
  ['wrong website',f=>{f.account.vars.website='getjunction.ai';},'pilot_context_mismatch'],
  ['mismatched build',f=>{f.health.build.sha='old';},'app_worker_release_or_health_mismatch'],
  ['unsafe flags',f=>{f.env.LIVE_MODE_ENABLED='true';},'external_action_flags_not_off'],
  ['reused root',f=>{f.env.N8N_SHADOW_RECEIVER_TOKEN=f.env.N8N_SIGNING_SECRET;},'receiver_or_signing_format_invalid'],
  ['expired API key',f=>{f.env.N8N_EXECUTION_API_KEY_EXPIRES_AT='2000-01-01';},'execution_reader_configuration_invalid'],
]) test(`refuses ${name} without mutation`,async()=>{const f=fixture();change(f);const r=await inspectKeywordPilot(f);assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.includes(blocker));assert.equal(r.providerCalls,0);});

test('invalid API origin never receives the execution API key',async()=>{
  const f=fixture();f.env.N8N_EXECUTION_API_BASE_URL='https://other.example';await inspectKeywordPilot(f);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].headers,undefined);
});
test('transport and database failures are not empty/healthy results',async()=>{
  const f=fixture();f.readJson=async()=>{throw Error('synthetic failure');};await assert.rejects(inspectKeywordPilot(f));
  const g=fixture();g.readAccount=async()=>{throw Error('synthetic failure');};await assert.rejects(inspectKeywordPilot(g));
});
test('remote wrapper performs only the two bounded GETs and existing account read',async()=>{
  const f=fixture(),previous=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.ok(options.signal);return new Response(JSON.stringify(url.endsWith('/api/health')?f.health:f.workflow));};
  const db=new Proxy({}, {get(){throw Error('Unexpected database operation');}});
  const modules={
    '/app/dist/worker/worker/issueKeywordShadowPilot.js':{KEYWORD_PILOT_PIN:f.pin},
    '/app/dist/worker/worker/wiring.js':{serviceDb:()=>db},
    '/app/dist/worker/worker/accounts.js':{DbAccountsSource:class {constructor(given){assert.equal(given,db);} getAccount(id){return f.readAccount(id);}}},
    'node:crypto':{createHash},
  };
  try{const result=await remotePreflight(inspectKeywordPilot,name=>{assert.ok(Object.hasOwn(modules,name));return modules[name];},f.env);
    assert.equal(result.status,'PASS');assert.equal(calls.length,2);
  }finally{globalThis.fetch=previous;}
});
test('revision review normalizes only Ignore Bots, retaining credential and authority changes',async()=>{
  const f=fixture();f.workflow.nodes[0].parameters.options.ignoreBots=true;
  const original=(await inspectKeywordPilot(f)).revisionReview;
  f.workflow.nodes[0].parameters.options.ignoreBots=false;
  const corrected=(await inspectKeywordPilot(f)).revisionReview;
  assert.notEqual(original.definitionHash,corrected.definitionHash);
  assert.equal(original.ignoringOnlyIgnoreBotsHash,corrected.ignoringOnlyIgnoreBotsHash);
  f.workflow.nodes[0].credentials.httpHeaderAuth.id='different';
  assert.notEqual((await inspectKeywordPilot(f)).revisionReview.ignoringOnlyIgnoreBotsHash,corrected.ignoringOnlyIgnoreBotsHash);
});
