// Independent local PostgreSQL connections; no env files, cloud or provider calls.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.'))throw new Error('Pass existing isolated embedded-postgres dependency directory');
const require=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(require.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'junction-review-concurrency-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',port:55441,
 persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
try{
 await cluster.initialise();await cluster.start();await cluster.createDatabase('review_acceptance');
 for(let i=0;i<3;i++){const c=cluster.getPgClient('review_acceptance','127.0.0.1');await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);}
 const [admin,a,b]=clients;
 await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to service_role;
 create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean not null default false,monthly_llm_cap_usd numeric default 1);
 create table account_members(account_id uuid,user_id uuid,role text);
 create table routine_runs(id uuid primary key,account_id uuid,context_generation bigint);
 create table artifacts(id uuid primary key,account_id uuid,run_id uuid);
 grant usage on schema public to service_role;
 grant select,update on accounts,account_members,routine_runs,artifacts to service_role;`);
 const files=['20260908151115_review_outputs.sql','20260908154525_review_history.sql','20260908154544_review_action_approvals.sql',
 '20260908154740_review_service_grants.sql','20260908165411_review_action_execution.sql','20260908170103_review_action_reconciliation.sql'];
 let source='';for(const file of files){const sql=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');await admin.query(sql);source+=sql;}
 await a.query('set role service_role');await b.query('set role service_role');
 const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid,pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 assert.notEqual(pidA,pidB);
 const acct=randomUUID(),actor=randomUUID();
 await admin.query('insert into accounts(id,context_generation) values($1,1)',[acct]);
 await admin.query("insert into account_members values($1,$2,'owner')",[acct,actor]);
 await admin.query('insert into routine_runs values($1,$1,1)',[acct]);
 await admin.query('insert into artifacts values($1,$1,$1)',[acct]);
 async function fixture(){
  const output=randomUUID(),proposal=randomUUID();
  await a.query("select register_review_output($1,1,$1,$1,$2,'brief',array[]::text[],null,'{\"title\":\"Synthetic\",\"body\":\"test\"}'::jsonb)",[acct,output]);
  await a.query("select propose_review_action($1,1,$2,0,$3,'prepare_provider_draft','local-test','Synthetic','{}'::jsonb,now()+interval '10 minutes')",[acct,output,proposal]);
  await a.query("select decide_review_action($1,1,$2,$3,0,$4,'approved')",[acct,actor,output,proposal]);
  return {output,proposal};
 }
 const claim=(c,f)=>c.query('select claim_review_action($1,1,$2,$3) result',[acct,f.proposal,randomUUID()]);
 const hold=(c,f)=>c.query("select decide_review_action($1,1,$2,$3,0,$4,'held') result",[acct,actor,f.output,f.proposal]);
 const settle=p=>p.then(result=>({result}),error=>({error}));
 async function commitBlocked(pending){
  let blocked=false;
  for(let i=0;i<80;i++){
   if((await admin.query('select $1::int=any(pg_blocking_pids($2)) blocked',[pidA,pidB])).rows[0].blocked){blocked=true;break;}
   await new Promise(r=>setTimeout(r,25));
  }
  assert.ok(blocked,'Second independent session must block on the first transaction');
  await a.query('commit');return pending;
 }
 let f=await fixture();await a.query('begin');assert.ok((await claim(a,f)).rows[0].result);
 let result=await commitBlocked(settle(claim(b,f)));assert.equal(result.result.rows[0].result,null);
 checks.push('two independent workers: exactly one dispatch ticket');
 f=await fixture();await a.query('begin');await hold(a,f);
 result=await commitBlocked(settle(claim(b,f)));assert.equal(result.error?.code,'40001');
 checks.push('hold commits before claim: no dispatch');
 f=await fixture();await a.query('begin');await claim(a,f);
 result=await commitBlocked(settle(hold(b,f)));assert.equal(result.error?.code,'40001');
 checks.push('claim commits before hold: no false cancellation');
 f=await fixture();await a.query('begin');await a.query('update review_outputs set revision=1 where id=$1',[f.output]);
 result=await commitBlocked(settle(claim(b,f)));assert.equal(result.error?.code,'40001');
 checks.push('revision changes while claim waits: stale approval refused');
 const reconcile=(c,f,evidence)=>c.query('select reconcile_review_action_success($1,1,$2,$3) result',[acct,f.proposal,evidence]);
 f=await fixture();const ticket=(await claim(a,f)).rows[0].result;
 await a.query("select record_review_action_result($1,1,$2,$3,'uncertain','{\"reason\":\"synthetic timeout\"}'::jsonb)",[acct,f.proposal,ticket.token]);
 await a.query('begin');await reconcile(a,f,{providerId:'synthetic-result'});
 result=await commitBlocked(settle(reconcile(b,f,{providerId:'synthetic-result'})));
 assert.equal(result.result.rows[0].result.duplicate,true);
 assert.equal((await claim(b,f)).rows[0].result,null);
 checks.push('concurrent identical reconciliation is idempotent and cannot redispatch');
 f=await fixture();await claim(a,f);await a.query('begin');await reconcile(a,f,{providerId:'first-result'});
 result=await commitBlocked(settle(reconcile(b,f,{providerId:'conflicting-result'})));
 assert.equal(result.error?.code,'40001');
 const proof=(await admin.query('select evidence from review_action_reconciliations where proposal_id=$1',[f.proposal])).rows[0].evidence;
 assert.deepEqual(proof,{providerId:'first-result'});
 checks.push('conflicting concurrent reconciliation cannot overwrite evidence');
 f=await fixture();await a.query('begin');await a.query('update accounts set automation_paused=true where id=$1',[acct]);
 result=await commitBlocked(settle(claim(b,f)));assert.equal(result.error?.code,'40001');
 checks.push('account pause commits while claim waits: dispatch refused');
 console.log(JSON.stringify({status:'PASS',checks,independentBackendPids:[pidA,pidB],postgres:(await admin.query('select version() v')).rows[0].v,
  sourceSha256:createHash('sha256').update(source).digest('hex'),providerCalls:0,cloudConnections:0,retainedTemporaryDirectory:directory,
  scope:'Exact review SQL; independent PostgreSQL sessions on minimal parent schema, not provider execution'},null,2));
}finally{
 for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 await cluster.stop();
}
