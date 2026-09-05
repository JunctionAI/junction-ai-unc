/** Real PostgreSQL for the configuration RPC on a minimal dependency schema.
 * Synthetic evidence only; no .env, provider or production connection. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.'))throw Error('Explicit local dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const require=createRequire(import.meta.url);
const {keywordPilotContract,KEYWORD_PILOT_PIN}=require('../dist/worker/lib/n8n/keywordAdmission.js');
const {keywordShadowSpec}=require('../dist/worker/lib/n8n/keywordShadowSpec.js');
const {keywordCommandMarket}=require('../dist/worker/lib/n8n/keywordCommand.js');
const directory=await mkdtemp(join(tmpdir(),'unc-keyword-configuration-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55442,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const table=(source,name)=>{const m=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));if(!m)throw Error('Missing table '+name);return m[0];};
const A='aa5cfc84-2569-4c99-9b40-67003ae55eda',owner='74802c60-149a-4405-b719-dc058d174072';
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase('configuration');
  for(let i=0;i<3;i++){const c=cluster.getPgClient('configuration','127.0.0.1');await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);}
  const [admin,a,b]=clients;
  const base=await sql('0001_init.sql'),artifacts=await sql('0013_artifacts.sql'),commands=await sql('20260904011301_routine_command_queue.sql');
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    ${['accounts','account_members','routine_states','routine_runs','approvals'].map(t=>table(base,t)).join('\n')}
    ${['artifacts','n8n_workflows'].map(t=>table(artifacts,t)).join('\n')}
    create table channel_links(id uuid primary key);${table(commands,'routine_commands')}
    alter table accounts add column context_generation bigint not null default 1,add column automation_paused boolean not null default true;
    alter table routine_runs add column context_generation bigint not null default 1,add column snapshot jsonb,add column spec_hash text;
    alter table routine_commands add column context_generation bigint not null default 1;
    ${table(await sql('20260905074645_keyword_shadow_admission.sql'),'public.n8n_shadow_permits')}
    grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;
    insert into auth.users values('${owner}');insert into accounts(id,name,currency) values('${A}','SYNTHETIC LOCAL ONLY','NZD');
    insert into account_members(account_id,user_id,role) values('${A}','${owner}','owner');`);
  // The complete exact migration is exercised in verify-keyword-command. This
  // focused schema runs its exact resulting configuration body without unrelated
  // command/recovery dependencies; only the reviewed literals are transformed.
  await admin.query((await sql('20260905153025_keyword_customer_configuration.sql'))
    .replaceAll('92135add-3c35-43e4-9649-5bb3d4557814',KEYWORD_PILOT_PIN.workflowVersion)
    .replaceAll("errcode='40001'","errcode='PT409'"));
  const registration=randomUUID();
  await admin.query("insert into n8n_workflows(id,account_id,routine_id,webhook_url,active) values($1,$2,'D03-W01',$3,true)",[registration,A,KEYWORD_PILOT_PIN.receiverUrl]);
  for(const [index,market] of ['US','NZ','AU'].entries()) {
    const run=randomUUID(),now=new Date(),contract=keywordPilotContract({authorizedBy:owner,approvalReference:'LOCAL',idempotencyKey:'LOCAL',market,contextGeneration:1,maxProviderCalls:1,expiresAt:new Date(now.getTime()+600000).toISOString()},now),spec=keywordShadowSpec(contract,2);
    const receipt={...contract,runId:run,status:'succeeded',mode:'dry_run',executedAction:'none',revisionEvidence:'verified_execution_record',executionId:String(index+1),revisionVerification:{source:'n8n_execution_record'}};
    await admin.query("insert into routine_runs(id,account_id,routine_id,version,mode,status,spec_hash) values($1,$2,'D03-W01',2,'dry_run','done','fixture-hash')",[run,A]);
    await admin.query("insert into artifacts(account_id,run_id,routine_id,kind,title,body,meta) values($1,$2,'D03-W01','keyword_list','SYNTHETIC','LOCAL ONLY',$3)",[A,run,{executionReceipt:receipt}]);
    await admin.query("insert into n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,spec_hash,spec,contract,receiver_url,status,expires_at,execution_id) values($1,1,$2,$3,$4,$5,'fixture-hash',$6,$7,$8,'verified',now(),$9)",[A,run,registration,owner,market,spec,contract,KEYWORD_PILOT_PIN.receiverUrl,String(index+1)]);
  }
  await a.query('set role service_role');await b.query('set role service_role');
  const input={accountId:A,actorId:owner,contextGeneration:1,operation:'read'};
  const call=(client,p=input)=>client.query('select keyword_customer_configuration($1) result',[p]).then(r=>r.rows[0].result);
  const first=await call(a),actor={accountId:A,userId:owner,contextGeneration:1,channel:'app',requestId:'LOCAL'};
  assert.deepEqual(first.candidates.map(c=>c.market),['AU','NZ','US']);assert.equal(first.spec,null);assert.equal(first.paused,true);
  for(const c of first.candidates)assert.equal(keywordCommandMarket(actor,c.spec,first.workflow),c.market);
  checks.push('paused owner reads three completed recipes with cleared run snapshots');
  const save={...input,operation:'save',market:'US',expectedVersion:1,expectedUpdatedAt:null,spec:first.candidates.find(c=>c.market==='US').spec};
  async function deny(name,change,request=save){await a.query('begin');try {const p=structuredClone(request);await change(p);await assert.rejects(call(a,p));checks.push(name);}finally{await a.query('rollback');}}
  await deny('wrong account',async p=>{p.accountId=randomUUID();});
  await deny('wrong owner',async p=>{p.actorId=randomUUID();});
  await deny('wrong generation',async p=>{p.contextGeneration=2;});
  await deny('arbitrary recipe',async p=>{p.spec.nodes=[];});
  await deny('unsupported market',async p=>{p.market='GB';});
  await deny('stale version',async p=>{p.expectedVersion=2;});
  await deny('revoked registration',async()=>{await a.query('update n8n_workflows set active=false');});
  await deny('missing independent receipt',async()=>{await a.query("update artifacts set meta='{}'");});
  await deny('wrong artifact account',async()=>{await a.query("update artifacts set routine_id='D03-W02'");});
  await deny('unresolved provider attempt',async()=>{await a.query("update n8n_shadow_permits set status='uncertain' where idempotency_key='NZ'");});
  const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid,pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await a.query('begin');const saved=await call(a,save);const waiting=call(b,save).then(result=>({result}),error=>({error}));
  let blocked=false;for(let i=0;i<80;i++){if((await admin.query('select $1::int=any(pg_blocking_pids($2)) blocked',[pidA,pidB])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
  assert(blocked);await a.query('commit');assert.equal((await waiting).error?.code,'PT409');checks.push('concurrent save has one winner');
  assert.equal(saved.enabled,false);assert.equal(saved.version,2);assert.deepEqual(saved.spec,save.spec);assert.equal((await call(a)).stateUpdatedAt,saved.stateUpdatedAt);checks.push('save and reload, no enable');
  const next={...save,market:'NZ',expectedVersion:2,expectedUpdatedAt:saved.stateUpdatedAt,spec:first.candidates.find(c=>c.market==='NZ').spec};
  await deny('enabled routine',async()=>{await a.query('update routine_states set enabled=true');},next);
  await deny('pending draft',async()=>{await a.query("update routine_states set draft_spec='{}'");},next);
  await deny('pending command',async()=>{await a.query("insert into routine_commands(id,account_id,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply) values($1,$2,$3,'app','local','hash','D03-W01','hash','hash',2,'LOCAL','queued','LOCAL')",[randomUUID(),A,owner]);},next);
  const changed=await call(a,next);assert.equal(keywordCommandMarket(actor,changed.spec,changed.workflow),'NZ');checks.push('explicit disabled-market change');
  const grants=(await admin.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') member,has_function_privilege('service_role',oid,'execute') server from pg_proc where proname='keyword_customer_configuration'")).rows[0];
  assert.deepEqual(grants,{prosecdef:false,anon:false,member:false,server:true});checks.push('service-only invoker grants');
  assert.equal(Number((await a.query('select count(*) from routine_runs')).rows[0].count),3);
  assert.equal(Number((await a.query('select count(*) from routine_commands')).rows[0].count),0);
  console.log(JSON.stringify({status:'PASS',checks,providerCalls:0,productionChanges:0,localDirectory:directory}));
}finally{for(const c of clients)await c.end();await cluster.stop();}
