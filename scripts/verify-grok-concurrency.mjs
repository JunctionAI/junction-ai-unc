// Independent local PostgreSQL backends. No hosted DB, native runtime or providers.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.'))throw new Error('Pass existing isolated embedded-postgres dependency directory');
const require=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(require.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'junction-grok-concurrency-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',port:55441,
 persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
try{
 await cluster.initialise();await cluster.start();await cluster.createDatabase('grok_acceptance');
 for(let i=0;i<3;i++){const c=cluster.getPgClient('grok_acceptance','127.0.0.1');await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);}
 const [admin,a,b]=clients;
 await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to service_role;
 create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean);
 create table account_members(account_id uuid,user_id uuid,role text);
 create table routine_states(account_id uuid,routine_id text,enabled boolean,updated_at timestamptz default now());
 create table routine_runs(id uuid default gen_random_uuid(),account_id uuid,routine_id text,status text);
 grant usage on schema public to service_role;
 grant select,insert,update on accounts,account_members,routine_states,routine_runs to service_role;`);
 for(const file of ['20260908171415_grok_control_records.sql','20260908173120_grok_settings_outbox.sql'])
  await admin.query(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await a.query('set role service_role');await b.query('set role service_role');
 const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid,pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 assert.notEqual(pidA,pidB);
 const acct=randomUUID(),actor=randomUUID();
 await admin.query('insert into accounts values($1,0,true)',[acct]);
 await admin.query("insert into account_members values($1,$2,'owner')",[acct,actor]);
 const settle=p=>p.then(result=>({result}),error=>({error}));
 async function commitBlocked(pending){
  let blocked=false;for(let i=0;i<80;i++){
   if((await admin.query('select $1::int=any(pg_blocking_pids($2)) blocked',[pidA,pidB])).rows[0].blocked){blocked=true;break;}
   await new Promise(r=>setTimeout(r,25));
  }
  assert.ok(blocked,'Independent connection must actually contend');await a.query('commit');return pending;
 }
 await a.query('begin');
 await a.query("insert into grok_routine_settings(account_id,routine_id,context_generation,worker_id,binding_evidence) values($1,'D02-W01',0,'test','synthetic local proof')",[acct]);
 let result=await commitBlocked(settle(b.query("insert into routine_runs(account_id,routine_id,status) values($1,'D02-W01','running')",[acct])));
 assert.equal(result.error?.code,'40001');checks.push('legacy run racing binding cannot start after cutover');
 await admin.query('update accounts set automation_paused=false where id=$1',[acct]);
 const sql="select set_grok_agent_settings($1,$2,0,'D02-W01',$3,'08:00','UTC',$4,$5) result";
 const first=randomUUID();
 await a.query('begin');await a.query(sql,[acct,actor,true,0,first]);
 result=await commitBlocked(settle(b.query(sql,[acct,actor,false,0,randomUUID()])));
 assert.equal(result.error?.code,'40001');checks.push('concurrent different changes: one revision winner');
 const second=randomUUID();await a.query('begin');await a.query(sql,[acct,actor,false,1,second]);
 result=await commitBlocked(settle(b.query(sql,[acct,actor,false,1,second])));
 assert.equal(result.result.rows[0].result.duplicate,true);checks.push('concurrent identical request: one outbox row and idempotent replay');
 assert.equal(Number((await admin.query('select count(*) n from grok_settings_outbox')).rows[0].n),2);
 await a.query('begin');await a.query('update accounts set automation_paused=true where id=$1',[acct]);
 result=await commitBlocked(settle(b.query(sql,[acct,actor,true,2,randomUUID()])));
 assert.equal(result.error?.code,'40001');checks.push('pause racing enable: enable refused');
 const change=(await admin.query('select change from grok_settings_outbox where id=$1',[second])).rows[0].change;
 const insert="insert into grok_control_records(id,account_id,context_generation,kind,platform,description,payload) values($1,$2,0,'notification','grok_control_request','synthetic claim',$3)";
 const args=[second,acct,{change}];await a.query('begin');await a.query(insert,args);
 result=await commitBlocked(settle(b.query(insert,args)));
 assert.equal(result.error?.code,'23505');checks.push('overlapping dispatchers: one persisted transport claim');
 console.log(JSON.stringify({status:'PASS',checks,independentBackendPids:[pidA,pidB],providerCalls:0,cloudConnections:0,retainedTemporaryDirectory:directory,
  scope:'actual migrations on minimal parent schema, independent PostgreSQL sessions; not native scheduler proof'},null,2));
}finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}await cluster.stop();}
