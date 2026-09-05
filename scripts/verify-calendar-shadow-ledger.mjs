/** Exact local migration + real engine continuation. No env files, remote DB or provider calls.
 * First compile with npx tsc -p tsconfig.calendar-sql.json. Pass the existing isolated PG dependency directory. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const require=createRequire(import.meta.url);
const {calendarShadowSpec}=require('../dist/worker/lib/n8n/calendarShadowSpec.js');
const {stableHash}=require('../dist/worker/lib/runtime/context.js');
const {planCalendarShadowCompletion}=require('../dist/worker/lib/runtime/engine.js');
const {runCalendarShadow}=require('../dist/worker/worker/runCalendarShadow.js');
const {N8N_EXECUTION_API_BASE}=require('../dist/worker/worker/providers/n8nExecutionReader.js');
const {SupabaseStore}=require('../dist/worker/lib/runtime/store/supabase.js');
const {HttpN8nBridge}=require('../dist/worker/worker/providers/n8n.js');
const {calendarShadowAuthority}=require('../dist/worker/lib/n8n/shadowAuthority.js');
const {projectCalendarShadowExecution}=require('../dist/worker/lib/n8n/executionEvidence.js');
const {calendarWeekStarts,calendarShadowArtifact,validateCalendarShadowReceipt,verifyCalendarShadowExecution}=require('../dist/worker/lib/n8n/calendarShadowContract.js');
const {verifiedShadowResult}=require('../dist/worker/lib/n8n/shadowCandidate.js');
const {DbCalendarShadowAdmission,calendarReservation,calendarStartClaim}=require('../dist/worker/lib/n8n/calendarAdmission.js');
const {completeCalendarShadowRun}=require('../dist/worker/worker/completeCalendarShadow.js');
const {reconcileCalendarShadowArchive}=require('../dist/worker/worker/reconcileCalendarShadow.js');
const directory=await mkdtemp(join(tmpdir(),'unc-calendar-ledger-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),
  authMethod:'scram-sha-256',port:55443,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],
  postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[], checks=[];
const a=randomUUID(), foreign=randomUUID(), owner=randomUUID(), binding=randomUUID(), registration=randomUUID();
const url='https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow';
const contract={contract:'unc.campaign-calendar-shadow.v1',accountId:a,workflowId:'synthetic-calendar',workflowVersion:randomUUID(),
  routineId:'D05-W07',routineKey:'campaign_calendar',client:{primaryDomain:'example.com',timezone:'Pacific/Auckland',currency:'NZD',bindingId:binding,klaviyoAccountId:'synthetic-asset'},data:{mode:'provider',queryHash:'a'.repeat(64)}};
const spec=calendarShadowSpec(contract,2);
let admin,client,peer,locker,db;
const clone=structuredClone;
function fixture(ttl=60000){
  const startedAt=new Date().toISOString(),id=randomUUID();
  const ctx={account:{accountId:a,contextGeneration:1,currency:'NZD',budgetMonthly:0},runId:id,routineId:'D05-W07',version:2,startedAt,
    mode:'dry_run',caps:{currency:'NZD',perDay:0,perMonth:0},triggeredBy:'manual',vars:{},inputs:{},reads:{},checks:{}};
  return {run:{id,accountId:a,contextGeneration:1,routineId:'D05-W07',version:2,mode:'dry_run',status:'running',startedAt,specHash:stableHash(spec),
    snapshot:{spec:clone(spec),ctx,nextNodeIndex:0,awaiting:'calendar_start',startProtocol:'calendar_claim_v1'}},
    approval:{authorizedBy:owner,approvalReference:'isolated-test',idempotencyKey:randomUUID(),contextGeneration:1,maxDispatches:1,expiresAt:new Date(Date.now()+ttl).toISOString()}};
}
const issue=(f,c=client)=>c.query('select issue_calendar_shadow_run($1) r',[f]).then(r=>r.rows[0].r);
const transition=(f,operation,extra={},c=client)=>c.query('select transition_calendar_shadow($1) r',[{accountId:f.run.accountId,contextGeneration:1,runId:f.run.id,operation,...extra}]).then(r=>r.rows[0].r);
const row=f=>admin.query('select * from n8n_calendar_runs where run_id=$1',[f.run.id]).then(r=>r.rows[0]);
async function waiting(f){
  const snapshot={...clone(f.run.snapshot),awaiting:'calendar_shadow',nextNodeIndex:2};
  await client.query('update routine_runs set snapshot=$1 where id=$2',[snapshot,f.run.id]); return snapshot;
}
const identity=f=>({contract:f.run.snapshot.spec.nodes[1].shadowContract,registrationId:registration,receiverUrl:url,requestDigest:'b'.repeat(64),tokenDigest:'c'.repeat(64),specHash:f.run.specHash});
async function authorized(f){await issue(f);assert.equal(await transition(f,'start',{run:f.run}),true);await waiting(f);
  assert.equal(typeof await transition(f,'dispatch',identity(f)),'string');assert.equal(await transition(f,'authorize',identity(f)),true);}
async function verified(f,{recovery=false}={}){
  await calendarReservation(db,f.approval)(f.run);assert.equal(await calendarStartClaim(db)(f.run),true);await waiting(f);
  const scope={accountId:a,contextGeneration:1,runId:f.run.id},admission=new DbCalendarShadowAdmission(db,scope);
  const scopedIdentity={...scope,...identity(f)};
  const permitId=await admission.claim(scopedIdentity);assert.equal(await admission.authorize(scopedIdentity),true);
  const run={...f.run,snapshot:{...clone(f.run.snapshot),awaiting:'calendar_shadow',nextNodeIndex:2}};
  const c=run.snapshot.spec.nodes[1].shadowContract,finishedAt=new Date().toISOString();
  const reported={contract:c.contract,accountId:a,runId:run.id,routineId:c.routineId,routineKey:c.routineKey,workflowId:c.workflowId,
    workflowVersion:null,revisionEvidence:'pending_unc_verification',executionId:'12345',startedAt:run.startedAt,finishedAt,mode:'dry_run',status:'succeeded',executedAction:'none',client:c.client,
    provider:{name:'klaviyo',dataset:'campaign_metadata',accountId:c.client.klaviyoAccountId,bindingId:binding,queryHash:c.data.queryHash,source:'provider',complete:true,itemsCount:0,fetchedAt:finishedAt,statusCode:200}};
  const artifact=calendarShadowArtifact({kind:'calendar',title:'Six proposed weeks',body:'Proposed education topics; timing is a hypothesis. Nothing scheduled.',
    items:calendarWeekStarts(run.startedAt,c.client.timezone).map(week=>({title:week,body:'Proposed product education email for review.',meta:{week_start:week,channel:'email',theme:'Education',timing_basis:'hypothesis'}})),meta:{},evidence:[]},c,{accountId:a,runId:run.id,routineId:'D05-W07',mode:'dry_run',startedAt:run.startedAt});
  const runIdentity={accountId:a,runId:run.id,routineId:'D05-W07',mode:'dry_run',startedAt:run.startedAt};
  const candidate={artifact,executionReceipt:validateCalendarShadowReceipt(reported,c,runIdentity,new Date()),resultDigest:'d'.repeat(64)};
  const seen={source:'n8n_execution_record',executionId:'12345',workflowId:c.workflowId,workflowVersion:c.workflowVersion,status:'success',finished:true,
    request:{accountId:a,runId:run.id,routineId:'D05-W07'},requestDigest:'b'.repeat(64),resultDigest:'d'.repeat(64),startedAt:run.startedAt,stoppedAt:finishedAt};
  const receipt=verifyCalendarShadowExecution(reported,seen,c,runIdentity,new Date(),'b'.repeat(64),'d'.repeat(64));
  const result=verifiedShadowResult(candidate,receipt);
  await admission.observe(permitId,'12345',candidate);
  if(recovery){
    await admission.finish(permitId,'uncertain','12345');
    // Recreate every adapter after interruption; only saved-execution reads exist.
    let reads=0;
    const deps={db,env:{},now:()=>new Date(Date.now()+86400000),readExecution:async()=>{reads++;return seen;}};
    const recovered=await reconcileCalendarShadowArchive({...scope,permitId},deps);assert.equal(recovered.providerDispatches,0);assert.equal(reads,1);
    assert.equal((await reconcileCalendarShadowArchive({...scope,permitId},deps)).alreadyVerified,true);assert.equal(reads,1);
    checks.push('recreated recovery adapter verifies original request/result after one day, never redispatches, then reads back its immutable archive');
  }else await admission.finish(permitId,'verified','12345',result);
  return {candidate,result,run,packet:await planCalendarShadowCompletion(run,result.artifact)};
}
const commit=(f,packet=null,c=client)=>c.query('select commit_calendar_shadow_completion($1,1,$2,$3) r',[a,f.run.id,packet]).then(r=>r.rows[0].r);
async function refusal(fn,pattern){await assert.rejects(fn,pattern);}
// Small SQL transport for the actual production adapters, not a database behavior mock.
function pgDb(c){
  const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unexpected SQL identifier');return '"'+s+'"';};
  return {
    from(table){return {update(patch){
      const params=Object.values(patch),sets=Object.keys(patch).map((k,i)=>`${ident(k)}=$${i+1}`);let filter;
      const chain={eq(column,value){params.push(value);filter=`${ident(column)}=$${params.length}`;return chain;},select(){return chain;},single(){return chain;},
        async then(resolve){try{
          if(!filter)throw Error('Unscoped test update');
          const r=await c.query(`with changed as (update ${ident(table)} set ${sets.join(',')} where ${filter} returning *) select to_jsonb(changed) r from changed`,params);
          if(r.rows.length!==1)throw Error('Expected one changed SQL row');return resolve({data:r.rows[0].r,error:null});
        }catch(e){return resolve({data:null,error:{message:e.message,code:e.code}});}}
      };return chain;
    },select(columns='*'){
      const conditions=[],values=[];let single=false;
      const chain={eq(column,value){values.push(value);conditions.push(`${ident(column)}=$${values.length}`);return chain;},maybeSingle(){single=true;return chain;},
        async then(resolve){try{
          const cols=columns==='*'?'*':columns.split(',').map(s=>ident(s.trim())).join(',');
          const rows=(await c.query(`select to_jsonb(t) r from (select ${cols} from ${ident(table)}${conditions.length?' where '+conditions.join(' and '):''}) t`,values)).rows.map(r=>r.r);
          if(single&&rows.length>1)throw Error('Expected at most one SQL row');return resolve({data:single?rows[0]??null:rows,error:null});
        }catch(e){return resolve({data:null,error:{message:e.message,code:e.code}});}}
      };return chain;
    }};},
    async rpc(fn,args){try{
      let q,values;
      if(['issue_calendar_shadow_run','transition_calendar_shadow'].includes(fn)){q=`select ${fn}($1) r`;values=[args.input];}
      else if(fn==='commit_calendar_shadow_completion'){q='select commit_calendar_shadow_completion($1,$2,$3,$4) r';values=[args.acct,args.generation,args.requested_run,args.packet];}
      else throw Error('Unexpected RPC '+fn);
      return {data:(await c.query(q,values)).rows[0].r,error:null};
    }catch(e){return {data:null,error:{message:e.message,code:e.code}};}}
  };
}
try{
  await cluster.initialise();await cluster.start();await cluster.createDatabase('calendar_ledger');
  for(let i=0;i<4;i++){const c=cluster.getPgClient('calendar_ledger','127.0.0.1');await c.connect();await c.query("set statement_timeout='5s'");clients.push(c);}
  [admin,client,peer,locker]=clients;
  db=pgDb(client);
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema unc_private;create table auth.users(id uuid primary key);
    create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean,currency text);
    create table account_members(account_id uuid,user_id uuid,role text,primary key(account_id,user_id));
    create table n8n_workflows(id uuid primary key,account_id uuid,routine_id text,webhook_url text,active boolean);
    create table routine_states(account_id uuid,routine_id text,enabled boolean,version integer,draft_spec jsonb,live_spec jsonb,primary key(account_id,routine_id));
    create table routine_runs(id uuid primary key,account_id uuid,context_generation bigint,routine_id text,version integer,mode text,status text,started_at timestamptz,finished_at timestamptz,summary text,spec_hash text,snapshot jsonb,dedup_key text);
    create table artifacts(id uuid primary key,account_id uuid,run_id uuid,routine_id text,kind text,title text,body text,items jsonb,meta jsonb,evidence jsonb,status text,created_at timestamptz);
    create table receipts(id uuid primary key,account_id uuid,context_generation bigint,run_id uuid,kind text,description text,payload jsonb,created_at timestamptz);
    create table connectors(id uuid primary key,account_id uuid,platform text,external_ref text,status text);
    create table account_dataset_snapshots(id uuid primary key,account_id uuid,connector_id uuid,external_ref text,platform text,query_hash text,query jsonb,result jsonb,source_fetched_at timestamptz,stored_at timestamptz);
    grant usage on schema public,auth to service_role;grant all on all tables in schema public,auth to service_role;`);
  await admin.query(await readFile(new URL('../supabase/migrations/20260905185010_calendar_shadow_ledger.sql',import.meta.url),'utf8'));
  checks.push('exact migration compiles on real PostgreSQL');
  await admin.query('insert into auth.users values($1);',[owner]);
  await admin.query("insert into accounts values($1,1,false,'NZD'),($2,1,false,'NZD')",[a,foreign]);
  await admin.query("insert into account_members values($1,$2,'owner')",[a,owner]);
  await admin.query("insert into n8n_workflows values($1,$2,'D05-W07',$3,true)",[registration,a,url]);
  await admin.query("insert into routine_states values($1,'D05-W07',true,2,$2,$2)",[a,spec]);
  await client.query('set role service_role');await peer.query('set role service_role');
  await client.query(`insert into n8n_calendar_bindings(id,account_id,context_generation,registration_id,accepted_by,acceptance_ref,credential_ref,asset_evidence_ref,workflow_definition_digest,spec_template)
    values($1,$2,1,$3,$4,'synthetic-reviewed-export','native-reference-only','synthetic-asset-proof',$5,$6)`,[binding,a,registration,owner,'e'.repeat(64),spec]);
  checks.push('owned reviewed binding accepted without storing credentials');
  for(const role of ['anon','authenticated']){await peer.query(`set role ${role}`);await refusal(()=>issue(fixture(),peer),{code:'42501'});await refusal(()=>peer.query('select * from n8n_calendar_runs'),{code:'42501'});}
  await peer.query('set role service_role');checks.push('browser roles cannot issue allowances or read ledger');
  const f=fixture();const duplicates=await Promise.all([issue(f),issue(f,peer)]);
  assert.equal(duplicates.filter(r=>r.created).length,1);assert.equal(duplicates[0].runId,duplicates[1].runId);
  const starts=await Promise.all([transition(f,'start',{run:f.run}),transition(f,'start',{run:f.run},peer)]);
  assert.equal(starts.filter(Boolean).length,1);checks.push('concurrent issuance and start each have one winner');
  await waiting(f);const dispatches=await Promise.all([transition(f,'dispatch',identity(f)),transition(f,'dispatch',identity(f),peer)]);
  assert.equal(dispatches.filter(Boolean).length,1);
  assert.equal(await transition(f,'authorize',{...identity(f),tokenDigest:'f'.repeat(64)}),false);
  const allowances=await Promise.all([transition(f,'authorize',identity(f)),transition(f,'authorize',identity(f),peer)]);
  assert.equal(allowances.filter(Boolean).length,1);checks.push('one dispatch and one exact token authority consumption');
  await transition(f,'finish',{outcome:'uncertain',executionId:'12345'});
  assert.equal(await transition(f,'dispatch',identity(f)),null);
  assert.equal(await transition(f,'authorize',identity(f)),false);
  await refusal(()=>client.query("update n8n_calendar_runs set state='reserved' where run_id=$1",[f.run.id]),{code:'23514'});
  await refusal(()=>client.query('delete from n8n_calendar_runs where run_id=$1',[f.run.id]),{code:'42501'});
  assert.equal((await issue(f)).created,false);checks.push('uncertain allowance remains consumed and cannot be renewed or deleted');
  for(const change of [x=>x.approval.maxDispatches=2,x=>x.approval.extra='secret',x=>x.run.accountId=foreign,x=>delete x.run.startedAt]){
    const bad=fixture();change(bad);await refusal(()=>issue(bad));assert.equal((await admin.query('select count(*)::int n from routine_runs where id=$1',[bad.run.id])).rows[0].n,0);
  }checks.push('invalid issuance fails atomically without orphan runs');
  const completed=fixture();const v=await verified(completed);
  const bad=clone(v.packet);bad.result.artifact.body='Unverified replacement';await refusal(()=>commit(completed,bad),{code:'23514'});
  await admin.query('revoke insert on receipts from service_role');await refusal(()=>commit(completed,v.packet),{code:'42501'});
  assert.equal((await admin.query('select count(*)::int n from artifacts where run_id=$1',[completed.run.id])).rows[0].n,0);
  assert.equal((await row(completed)).state,'verified');await admin.query('grant insert on receipts to service_role');
  const commits=await Promise.all([commit(completed,v.packet),commit(completed,v.packet,peer)]);
  const wireResult=JSON.parse(JSON.stringify(v.packet.result));
  assert.deepEqual(commits[0],wireResult);assert.deepEqual(commits[1],wireResult);assert.deepEqual(await commit(completed),wireResult);
  assert.equal((await admin.query('select count(*)::int n from artifacts where run_id=$1',[completed.run.id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from receipts where run_id=$1',[completed.run.id])).rows[0].n,3);
  checks.push('real engine plan atomically creates one draft and three receipts; concurrent/lost-reply completion is idempotent','receipt insertion failure rolls back artifact, run and ledger changes');
  const recoveredRun=fixture();await verified(recoveredRun,{recovery:true});
  const scope={accountId:a,contextGeneration:1,runId:recoveredRun.run.id};
  const result=await completeCalendarShadowRun(db,scope);assert.equal(result.status,'done');
  assert.deepEqual(await completeCalendarShadowRun(pgDb(peer),scope),result);
  assert.equal((await row(recoveredRun)).state,'completed');checks.push('production completion adapter projects recovered calendar and safely reads original completion on restart');
  // Full engine/bridge/authority with actual SQL persistence, synthetic HTTP only.
  const e2e=fixture(),store=new SupabaseStore(db);let posts=0,executionReads=0,postedBody,reply,execStarted,execFinished;
  const env={NODE_ENV:'production',N8N_SIGNING_SECRET:'synthetic-root-signing-key',N8N_CALENDAR_SHADOW_RECEIVER_URL:url,
    N8N_CALENDAR_SHADOW_RECEIVER_TOKEN:'synthetic-calendar-receiver',N8N_SHADOW_RECEIVER_TOKEN:'synthetic-other-receiver',N8N_DATA_BASE_URL:'https://unc.example.com',
    N8N_CALENDAR_SHADOW_WORKFLOW_ID:contract.workflowId,N8N_CALENDAR_SHADOW_TRIGGER_NODE_ID:'trigger-node',N8N_CALENDAR_SHADOW_RESULT_NODE_ID:'result-node',
    N8N_EXECUTION_READER_ENABLED:'true',N8N_EXECUTION_API_BASE_URL:N8N_EXECUTION_API_BASE,N8N_EXECUTION_API_KEY:'synthetic-independent-read-key'};
  const bridge=new HttpN8nBridge({env,lookup:async()=>[{address:'93.184.216.34',family:4}],
    calendarShadowAdmissionFor:scope=>new DbCalendarShadowAdmission(db,scope),
    fetch:async(target,init)=>{
      assert.equal(String(target),url);assert.equal(init.method,'POST');posts++;postedBody=JSON.parse(init.body);execStarted=new Date().toISOString();
      const req=()=>new Request('https://unc.example.com/api/n8n/calendar-shadow-authority',{method:'POST',headers:{authorization:`Bearer ${postedBody.dataToken}`}});
      const deps={store,db,secret:env.N8N_SIGNING_SECRET,credentials:{},credentialsKind:'none'};
      const auth=await calendarShadowAuthority(deps,req(),url);assert.equal(auth.status,200);assert.deepEqual((await auth.json()).shadow,contract);
      assert.equal((await calendarShadowAuthority(deps,req(),url)).status,409);
      execFinished=new Date().toISOString();
      reply={artifact:{kind:'calendar',title:'Engine proposed calendar',body:'Six education proposals for review; timing remains hypothetical.',
        items:calendarWeekStarts(postedBody.startedAt??e2e.run.startedAt,contract.client.timezone).map(week=>({title:week,body:'Proposed product education email.',meta:{week_start:week,channel:'email',theme:'Education',timing_basis:'hypothesis'}})),meta:{},evidence:[]},
        executionReceipt:{contract:contract.contract,accountId:a,runId:postedBody.runId,routineId:'D05-W07',routineKey:'campaign_calendar',workflowId:contract.workflowId,workflowVersion:null,revisionEvidence:'pending_unc_verification',executionId:'56789',
          startedAt:execStarted,finishedAt:execFinished,mode:'dry_run',status:'succeeded',executedAction:'none',client:contract.client,
          provider:{name:'klaviyo',dataset:'campaign_metadata',accountId:contract.client.klaviyoAccountId,bindingId:binding,queryHash:contract.data.queryHash,source:'provider',complete:true,itemsCount:0,fetchedAt:execFinished,statusCode:200}}};
      return Response.json(reply);
    },readCalendarShadowExecution:async()=>{
      executionReads++;
      return projectCalendarShadowExecution({id:'56789',workflowId:contract.workflowId,workflowVersionId:contract.workflowVersion,status:'success',finished:true,mode:'webhook',startedAt:execStarted,stoppedAt:execFinished,
        workflowData:{id:contract.workflowId,versionId:contract.workflowVersion,nodes:[{id:'trigger-node',name:'Incoming',type:'n8n-nodes-base.webhook'},{id:'result-node',name:'Result',type:'n8n-nodes-base.code'}]},
        data:{resultData:{runData:{Incoming:[{executionStatus:'success',data:{main:[[{json:{body:postedBody}}]]}}],Result:[{executionStatus:'success',data:{main:[[{json:reply}]]}}]}}}},
        {workflowId:contract.workflowId,executionId:'56789',triggerNodeId:'trigger-node',resultNodeId:'result-node'});
    }});
  const forbidden=async()=>{throw Error('No native provider/model/executor is allowed');};
  const engineResult=await runCalendarShadow({accountId:a,contextGeneration:1,runId:e2e.run.id,bindingId:binding,approval:e2e.approval},
    {db,account:e2e.run.snapshot.ctx.account,env,adapters:{store,n8n:bridge,reader:{read:forbidden},decider:{decide:forbidden},executor:{execute:forbidden},
      completeCalendarShadow:run=>completeCalendarShadowRun(db,{accountId:a,contextGeneration:1,runId:run.id})}});
  assert.equal(engineResult.status,'done',JSON.stringify(engineResult));assert.equal(posts,1);assert.equal(executionReads,1);
  assert.equal(engineResult.artifact.meta.executionReceipt.executionId,'56789');assert.equal(engineResult.receipts.length,3);
  assert.equal((await row(e2e)).state,'completed');
  checks.push('full real engine -> SQL admission -> authority -> bridge -> saved-output projection -> SQL completion succeeds with exactly one synthetic POST and GET');
  await refusal(()=>transition({...f,run:{...f.run,accountId:foreign}},'finish',{outcome:'uncertain',executionId:'12345'}),{code:'P0002'});
  await refusal(()=>client.query("update n8n_calendar_runs set execution_id='999' where run_id=$1",[f.run.id]),{code:'23514'});
  await refusal(()=>client.query("update n8n_calendar_bindings set credential_ref='another' where id=$1",[binding]),{code:'23514'});
  checks.push('cross-tenant transition, execution rebinding and credential-reference replacement refused');
  // Observe an actual PostgreSQL lock wait before releasing a changed permission.
  async function waitForLock(){for(let i=0;i<100;i++){const r=await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID]);
    if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Expected lock wait was not observed');}
  for(const phase of ['start','dispatch','authorize'])for(const kind of ['pause','generation','owner','switch','registration','expiry']){
    const g=fixture(kind==='expiry'?450:60000);await issue(g);
    if(phase!=='start'){await transition(g,'start',{run:g.run});await waiting(g);}
    if(phase==='authorize')await transition(g,'dispatch',identity(g));
    await locker.query('begin');
    const mutations={pause:["update accounts set automation_paused=true where id=$1",a],generation:['update accounts set context_generation=2 where id=$1',a],
      owner:["update account_members set role='viewer' where account_id=$1",a],switch:["update routine_states set enabled=false where account_id=$1",a],
      registration:['update n8n_workflows set active=false where id=$1',registration],expiry:['select id from accounts where id=$1 for update',a]};
    await locker.query(mutations[kind][0],[mutations[kind][1]]);
    const pending=transition(g,phase,phase==='start'?{run:g.run}:identity(g)).then(r=>({r}),e=>({e}));await waitForLock();
    if(kind==='expiry')await locker.query('select pg_sleep(0.5)');
    await locker.query('commit');const outcome=await pending;assert.equal(outcome.e?.code,'40001',`${phase}/${kind} must refuse after lock`);
    await admin.query("update accounts set automation_paused=false,context_generation=1;update account_members set role='owner';update routine_states set enabled=true;update n8n_workflows set active=true");
    checks.push(`${phase}: observed lock wait rechecks ${kind}`);
  }
  const connector=randomUUID(),snapshotId=randomUUID(),fetchedAt=new Date().toISOString();
  await admin.query("insert into connectors values($1,$2,'klaviyo','synthetic-asset','connected')",[connector,a]);
  await admin.query("insert into account_dataset_snapshots values($1,$2,$3,'synthetic-asset','klaviyo',$4,$5,$6,$7,now())",
    [snapshotId,a,connector,'a'.repeat(64),{resource:'campaigns'},{provenance:'empty',metrics:{campaign_history_contract:'unc.klaviyo-campaign-history.v1'}},fetchedAt]);
  const stored=()=>{const g=fixture();g.run.snapshot.spec.nodes[1].shadowContract.data={mode:'stored',queryHash:'a'.repeat(64),snapshotId,fetchedAt,maxAgeSeconds:3600};g.run.specHash=stableHash(g.run.snapshot.spec);return g;};
  await issue(stored());checks.push('owned exact fresh stored campaign snapshot accepted');
  for(const mutate of [x=>delete x.maxAgeSeconds,x=>x.maxAgeSeconds=0,x=>x.snapshotId=randomUUID(),x=>x.queryHash='f'.repeat(64),x=>x.fetchedAt=new Date(0).toISOString()]){
    const g=stored();mutate(g.run.snapshot.spec.nodes[1].shadowContract.data);g.run.specHash=stableHash(g.run.snapshot.spec);await refusal(()=>issue(g));
  }
  await admin.query('update account_dataset_snapshots set account_id=$1 where id=$2',[foreign,snapshotId]);await refusal(()=>issue(stored()),{code:'40001'});
  await admin.query('update account_dataset_snapshots set account_id=$1 where id=$2',[a,snapshotId]);
  await admin.query("update connectors set status='disconnected' where id=$1",[connector]);await refusal(()=>issue(stored()),{code:'40001'});
  checks.push('stored source missing age, invalid age, foreign/missing snapshot, wrong hash/time and disconnected asset refused');
  const aging=stored(),freshTime=new Date().toISOString();aging.run.snapshot.spec.nodes[1].shadowContract.data.fetchedAt=freshTime;
  aging.run.snapshot.spec.nodes[1].shadowContract.data.maxAgeSeconds=1;aging.run.specHash=stableHash(aging.run.snapshot.spec);
  await admin.query('update account_dataset_snapshots set source_fetched_at=$1 where id=$2',[freshTime,snapshotId]);
  await admin.query("update connectors set status='connected' where id=$1",[connector]);
  await locker.query('begin');await locker.query('select id from connectors where id=$1 for update',[connector]);
  const agingIssue=issue(aging).then(r=>({r}),e=>({e}));await waitForLock();await locker.query('select pg_sleep(1.1)');await locker.query('commit');
  assert.equal((await agingIssue).e?.code,'40001','snapshot must still be fresh after connector lock');
  checks.push('stored snapshot freshness rechecked after observed connector lock wait');
  const revoked=fixture();await issue(revoked);await client.query('update n8n_calendar_bindings set revoked_at=now() where id=$1',[binding]);
  await refusal(()=>transition(revoked,'start',{run:revoked.run}),{code:'40001'});
  await refusal(()=>client.query('update n8n_calendar_bindings set revoked_at=null where id=$1',[binding]),{code:'23514'});
  checks.push('binding revocation blocks unused allowance and cannot be reversed');
  const functions=(await admin.query("select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','unc_calendar_private') and (p.proname like '%calendar%')")).rows;
  assert.equal(functions.length,7);for(const fn of functions){assert.equal(fn.prosecdef,false);assert.deepEqual(fn.proconfig,['search_path=""']);}
  checks.push('all seven functions security-invoker with empty search_path');
  console.log(JSON.stringify({status:'PASS',checks,providerCalls:0,remoteDatabaseCalls:0},null,2));
}finally{for(const c of clients)await c.end().catch(()=>{});await cluster.stop().catch(()=>{});}
