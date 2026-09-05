/** Isolated PostgreSQL acceptance of the real command/permit RPCs. No .env,
 * production DB, n8n or DataForSEO connection. Requires a compiled worker. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.'))throw Error('Explicit isolated PostgreSQL dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const require=createRequire(import.meta.url);
const {keywordPilotContract,KEYWORD_PILOT_PIN}=require('../dist/worker/lib/n8n/keywordAdmission.js');
const {keywordShadowSpec}=require('../dist/worker/lib/n8n/keywordShadowSpec.js');
const {keywordCommandApproval,keywordCommandRunOptions}=require('../dist/worker/lib/n8n/keywordCommand.js');
const {workflowFingerprint}=require('../dist/worker/lib/commands/releaseScope.js');
const {commandId,digest}=require('../dist/worker/lib/commands/queue.js');
const {runRoutine}=require('../dist/worker/lib/runtime/engine.js');
const {MemoryStore}=require('../dist/worker/lib/runtime/store/memory.js');
const directory=await mkdtemp(join(tmpdir(),'unc-keyword-command-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55441,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const sql=name=>read('../supabase/migrations/'+name);
const table=(source,name)=>{const m=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));if(!m)throw Error('Missing table '+name);return m[0];};
const A='aa5cfc84-2569-4c99-9b40-67003ae55eda',owner='74802c60-149a-4405-b719-dc058d174072';
let admin,a,b;
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase('keyword_command_acceptance');
  for(let i=0;i<3;i++){const c=cluster.getPgClient('keyword_command_acceptance','127.0.0.1');await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);}
  [admin,a,b]=clients;
  const base=await sql('0001_init.sql'),artifacts=await sql('0013_artifacts.sql'),commands=await sql('20260904011301_routine_command_queue.sql');
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema unc_private;create table auth.users(id uuid primary key);
    ${['accounts','account_members','resource_profiles','routine_states','routine_runs','approvals','receipts'].map(t=>table(base,t)).join('\n')}
    ${['artifacts','n8n_workflows'].map(t=>table(artifacts,t)).join('\n')}
    create table channel_links(id uuid primary key);${table(commands,'routine_commands')}
    alter table accounts add column context_generation bigint not null default 1,add column automation_paused boolean not null default false;
    alter table routine_runs add column context_generation bigint not null default 1,add column snapshot jsonb,add column spec_hash text,add column approval_id uuid;
    alter table routine_commands add column context_generation bigint not null default 1,add column channel_binding jsonb;
    grant usage on schema public,unc_private to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    insert into auth.users values('${owner}');
    insert into accounts(id,name,currency) values('${A}','SYNTHETIC LOCAL ONLY','NZD');
    insert into account_members(account_id,user_id,role) values('${A}','${owner}','owner');
    insert into resource_profiles(account_id,website,budget_monthly) values('${A}','https://avgarsport.com',1000);`);
  for(const name of ['20260905074645_keyword_shadow_admission.sql','20260905083033_keyword_shadow_pilot_issuance.sql',
    '20260905092340_keyword_shadow_prepared_start.sql','20260905145250_keyword_shadow_bot_filter_revision.sql','20260905151627_keyword_command_admission.sql'])
    await admin.query(await sql(name));
  const grants=(await admin.query(`select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('authenticated',p.oid,'execute') member,has_function_privilege('service_role',p.oid,'execute') server
    from pg_proc p where p.proname in ('assert_keyword_command_binding','issue_keyword_shadow_command','claim_keyword_shadow_command_start') order by p.proname`)).rows;
  assert.equal(grants.length,3);for(const g of grants)assert.deepEqual([g.prosecdef,g.anon,g.member,g.server],[false,false,false,true]);
  await a.query('set role service_role');await b.query('set role service_role');
  const registration=randomUUID(),workflow={id:registration,accountId:A,routineId:'D03-W01',webhookUrl:KEYWORD_PILOT_PIN.receiverUrl,active:true};
  await admin.query('insert into n8n_workflows(id,account_id,routine_id,webhook_url,active) values($1,$2,$3,$4,true)',[registration,A,'D03-W01',workflow.webhookUrl]);
  async function fixture(market) {
    const now=new Date(),actor={accountId:A,userId:owner,contextGeneration:1,channel:'app',requestId:randomUUID()};
    const approval={authorizedBy:owner,approvalReference:'SYNTHETIC-LOCAL',idempotencyKey:'SYNTHETIC-LOCAL',market,contextGeneration:1,maxProviderCalls:1,expiresAt:new Date(now.getTime()+600000).toISOString()};
    let spec=keywordShadowSpec(keywordPilotContract(approval,now),2);
    await admin.query(`insert into routine_states(account_id,routine_id,enabled,version,live_spec) values($1,'D03-W01',true,2,$2)
      on conflict(account_id,routine_id) do update set enabled=true,version=2,live_spec=excluded.live_spec`,[A,spec]);
    // Actual JSONB read order: admission must not depend on object-key insertion order.
    spec=(await admin.query("select live_spec from routine_states where account_id=$1 and routine_id='D03-W01'",[A])).rows[0].live_spec;
    const id=commandId(actor),request='/run D03-W01',c={id,actor,contextGeneration:1,request,requestHash:digest(request),routineId:spec.id,version:2,
      specHash:digest(spec),workflowHash:workflowFingerprint(workflow),status:'running',runId:id,reply:'Synthetic local only',createdAt:now.toISOString(),updatedAt:now.toISOString()};
    await admin.query(`insert into routine_commands(id,account_id,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply,run_id,created_at,updated_at)
      values($1,$2,$3,'app',$4,$5,'D03-W01',$6,$7,2,$8,'running',$9,$1,$10,$10)`,[id,A,owner,actor.requestId,c.requestHash,c.specHash,c.workflowHash,request,c.reply,c.createdAt]);
    let packet;const stop=Error('capture-only');
    const db={rpc:async(name,args)=>{assert.equal(name,'issue_keyword_shadow_command');packet=args.input;throw stop;}};
    await assert.rejects(runRoutine(spec,{account:{accountId:A,contextGeneration:1,currency:'NZD',budgetMonthly:1000},vars:{website:'https://avgarsport.com'},triggeredBy:'manual'},
      {store:new MemoryStore()},keywordCommandRunOptions(db,c,spec,workflow,()=>now)),e=>e===stop);
    assert.deepEqual(packet.approval,keywordCommandApproval(c,spec,workflow,now));
    return {c,packet,spec};
  }
  const issue=(client,input)=>client.query('select issue_keyword_shadow_command($1) result',[input]).then(r=>r.rows[0].result);
  const claim=(client,input)=>client.query('select claim_keyword_shadow_command_start($1) result',[
    {run:input.run,commandId:input.commandId,commandSpecJson:input.commandSpecJson,commandWorkflowJson:input.commandWorkflowJson}]).then(r=>r.rows[0].result);
  const f=await fixture('US');
  async function denied(name,change) {
    await a.query('begin');
    try {const input=structuredClone(f.packet);await change(input);await assert.rejects(issue(a,input));checks.push(name);}
    finally{await a.query('rollback');}
    assert.equal(Number((await admin.query('select count(*) from n8n_shadow_permits')).rows[0].count),0);
  }
  await denied('wrong command',async p=>{p.commandId=randomUUID();});
  await denied('wrong tenant',async p=>{p.run.accountId=randomUUID();});
  await denied('changed market',async p=>{p.approval.market='NZ';});
  await denied('renewed expiry',async p=>{p.approval.expiresAt=new Date(Date.parse(p.approval.expiresAt)+1000).toISOString();});
  await denied('substituted spec bytes',async p=>{p.commandSpecJson='{}';});
  await denied('substituted workflow bytes',async p=>{p.commandWorkflowJson='{}';});
  await denied('unclaimed command',async()=>{await a.query("update routine_commands set status='queued' where id=$1",[f.c.id]);});
  await denied('switch off',async()=>{await a.query('update routine_states set enabled=false where account_id=$1',[A]);});
  await denied('owner revoked',async()=>{await a.query("update account_members set role='member' where account_id=$1",[A]);});
  await denied('account paused',async()=>{await a.query('update accounts set automation_paused=true where id=$1',[A]);});
  await denied('context reset',async()=>{await a.query('update accounts set context_generation=2 where id=$1',[A]);});
  await denied('registration revoked',async()=>{await a.query('update n8n_workflows set active=false where account_id=$1',[A]);});
  await denied('non-app channel',async()=>{await a.query("update routine_commands set channel='slack' where id=$1",[f.c.id]);});

  // Independent sessions: confirm the second issuer is waiting on our transaction.
  const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid,pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await a.query('begin');const first=await issue(a,f.packet);
  const pending=issue(b,f.packet).then(result=>({result}),error=>({error}));
  let blocked=false;
  for(let i=0;i<80;i++){if((await admin.query('select $1::int = any(pg_blocking_pids($2)) blocked',[pidA,pidB])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
  assert(blocked,'Independent issuer did not enter a PostgreSQL lock wait');await a.query('commit');
  const duplicate=await pending;if(duplicate.error)throw duplicate.error;
  assert(first.created);assert.equal(duplicate.result.created,false);assert.equal(first.runId,duplicate.result.runId);checks.push('concurrent issuance one winner');
  const starts=await Promise.all([claim(a,f.packet),claim(b,f.packet)]);assert.equal(starts.filter(Boolean).length,1);checks.push('concurrent start one winner');
  const dispatch={accountId:A,contextGeneration:1,runId:f.c.id,registrationId:registration,contract:f.packet.contract,receiverUrl:workflow.webhookUrl,requestDigest:'a'.repeat(64),tokenDigest:'b'.repeat(64)};
  await admin.query('update routine_states set enabled=false where account_id=$1',[A]);
  await assert.rejects(a.query('select claim_keyword_shadow_dispatch($1)',[dispatch]));checks.push('switch-off blocks dispatch');
  await admin.query('update routine_states set enabled=true where account_id=$1',[A]);
  assert.equal((await a.query('select claim_keyword_shadow_dispatch($1) permit',[dispatch])).rows[0].permit,first.permitId);
  const authority={...dispatch,specHash:f.packet.run.specHash};
  await admin.query('update routine_states set enabled=false where account_id=$1',[A]);
  await assert.rejects(a.query('select consume_keyword_shadow_authority($1)',[authority]));checks.push('switch-off blocks provider authority');
  await admin.query('update routine_states set enabled=true where account_id=$1',[A]);
  assert.equal((await a.query('select consume_keyword_shadow_authority($1) allowed',[authority])).rows[0].allowed,true);
  assert.equal((await a.query('select consume_keyword_shadow_authority($1) allowed',[authority])).rows[0].allowed,false);checks.push('one provider authority consumption');
  for(const market of ['NZ','AU']){const m=await fixture(market);assert((await issue(a,m.packet)).created);assert(await claim(a,m.packet));checks.push(market+' distinct market allowance');}
  assert.equal(Number((await admin.query('select count(*) from n8n_shadow_permits')).rows[0].count),3);
  assert.equal(Number((await admin.query('select count(*) from artifacts')).rows[0].count),0);
  console.log(JSON.stringify({status:'PASS',checks,grants,providerCalls:0,productionChanges:0,localDirectory:directory}));
} finally {for(const c of clients)await c.end();await cluster.stop();}
