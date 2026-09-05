/** Isolated real PostgreSQL concurrency test. Never reads .env or connects remotely.
 * Install pinned embedded-postgres in a temporary directory and pass that directory.
 * Exact manual RPC migration + exact editor read/runtime guard; minimal dependency schema.
 * This is not a complete Supabase deployment/role-advisor acceptance replacement. */
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith("/tmp/unc-manual-pg."))throw new Error("Pass the explicitly created isolated /tmp/unc-manual-pg.* dependency directory.");
const require=createRequire(join(dependencyDir,"package.json"));
const {default:EmbeddedPostgres}=await import(require.resolve("embedded-postgres"));
const directory=await mkdtemp(join(tmpdir(),"unc-manual-concurrency-"));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,"db"),user:"postgres",password:randomUUID(),authMethod:"scram-sha-256",
  port:55439,persistent:true,createPostgresUser:false,initdbFlags:["--locale=C"],postgresFlags:["-h","127.0.0.1","-k",directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
const sql=async name=>readFile(join(root,"supabase/migrations",name),"utf8");
const table=(source,name)=>{
  const match=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));
  if(!match)throw new Error(`Missing source table ${name}`);return match[0];
};
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase("manual_acceptance");
  for(let i=0;i<3;i++){const c=cluster.getPgClient("manual_acceptance","127.0.0.1");await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);}
  const [admin,a,b]=clients;
  const base=await sql("0001_init.sql"),presets=await sql("0015_presets.sql");
  await admin.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema unc_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    ${["accounts","account_members","resource_profiles","business_profiles","routine_states","routine_runs"].map(t=>table(base,t)).join("\n")}
    ${["account_presets","routine_params"].map(t=>table(presets,t)).join("\n")}
    alter table accounts add column context_generation bigint not null default 1, add column automation_paused boolean not null default false;
    alter table routine_runs add column context_generation bigint not null default 1, add column snapshot jsonb, add column spec_hash text;
    alter table routine_runs drop constraint routine_runs_status_check;
    alter table routine_runs add constraint routine_runs_status_check check(status in ('running','waiting_input','waiting_approval','done','failed','skipped'));
    create table kpi_snapshots(id uuid primary key,account_id uuid,context_generation bigint,metric_key text,value numeric,window_end timestamptz);
    create table memories(id uuid primary key,account_id uuid,context_generation bigint,text text,tags text[],kind text,valid_to timestamptz,created_at timestamptz);
    grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
  `);
  const editor=(await sql("20260905122638_routine_editor_atomic.sql")).split("-- The application validates")[0];
  await admin.query(editor);
  await admin.query(await sql("20260905052957_fix_context_trigger_parent_access.sql"));
  await admin.query("create trigger runtime_context before insert or update on routine_runs for each row execute function unc_private.guard_runtime_run_context()");
  const migration=await sql("20260905124522_manual_routine_admission.sql");await admin.query(migration);
  await a.query("set role service_role");await b.query("set role service_role");
  const pidA=(await a.query("select pg_backend_pid() pid")).rows[0].pid,pidB=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
  assert.notEqual(pidA,pidB);
  const account=randomUUID(),actor=randomUUID(),routine="D01-W01";
  const spec={id:routine,version:1,nodes:[{id:"receipt",kind:"receipt"}]};
  await admin.query("insert into auth.users values($1)",[actor]);
  await a.query("insert into accounts(id,name) values($1,'Synthetic local concurrency only')",[account]);
  await a.query("insert into account_members(account_id,user_id,role) values($1,$2,'owner')",[account,actor]);
  await a.query("insert into routine_states(account_id,routine_id,enabled,live_spec) values($1,$2,true,$3)",[account,routine,spec]);
  const revision=async()=>(await a.query("select read_routine_editor($1,$2,1,$3,'content')->>'configurationRevision' rev",[account,actor,routine])).rows[0].rev;
  const rev=await revision();
  function initial(id=randomUUID()){return {id,accountId:account,contextGeneration:1,routineId:routine,version:1,mode:"dry_run",status:"running",startedAt:new Date().toISOString(),specHash:"synthetic-local",
    snapshot:{spec,nextNodeIndex:0,startProtocol:"manual_claim_v1",ctx:{runId:id,routineId:routine,version:1,mode:"dry_run",triggeredBy:"manual",account:{accountId:account,contextGeneration:1}}}};}
  const identity=id=>[account,actor,1,id];
  const prepare=(c,id,record,purpose="run",body={})=>c.query("select prepare_manual_routine_request($1,$2,$3,$4,$5,$6,$7,$8) result",[...identity(id),purpose,body,rev,record]);
  const claim=(c,id)=>c.query("select claim_manual_routine_request($1,$2,$3,$4) result",identity(id));
  const cancel=(c,id,purpose="run")=>c.query("select cancel_manual_routine_request($1,$2,$3,$4,$5,$6) result",[...identity(id),routine,purpose]);
  const settle=promise=>promise.then(result=>({result}),error=>({error}));
  async function blockedThenCommit(pending,name) {
    let blocked=false;
    for(let i=0;i<80;i++) {
      const row=(await admin.query("select $1::int = any(pg_blocking_pids($2)) blocked",[pidA,pidB])).rows[0];
      if(row.blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,25));
    }
    assert(blocked,`${name}: independent connection did not enter a PostgreSQL lock wait`);
    await a.query("commit");const result=await pending;checks.push(name);return result;
  }
  const first=randomUUID(),record=initial();
  await a.query("begin");await prepare(a,first,record);
  let outcome=await blockedThenCommit(settle(prepare(b,first,initial())),"duplicate prepare: observed lock wait, original run preserved");
  assert.equal(outcome.result?.rows[0].result.run.id,record.id);
  await a.query("begin");assert.equal((await claim(a,first)).rows[0].result,true);
  outcome=await blockedThenCommit(settle(claim(b,first)),"duplicate claim: one true, one false");assert.equal(outcome.result?.rows[0].result,false);
  const cancelled=randomUUID();await a.query("begin");await cancel(a,cancelled);
  outcome=await blockedThenCommit(settle(prepare(b,cancelled,initial())),"missing-request cancel beats delayed prepare");assert.equal(outcome.error?.code,"40001");
  assert.equal((await a.query("select count(*)::int n from routine_runs")).rows[0].n,1);
  await a.query("update routine_runs set status='done' where id=$1",[record.id]);
  const competing=randomUUID(),competingRecord=initial();await a.query("begin");await prepare(a,competing,competingRecord);
  outcome=await blockedThenCommit(settle(prepare(b,randomUUID(),initial())),"distinct browser request IDs cannot create two unresolved runs");
  assert.equal(outcome.error?.code,"40001");
  await a.query("update routine_runs set status='done' where id=$1",[competingRecord.id]);
  const second=randomUUID(),record2=initial();await prepare(a,second,record2);
  await a.query("begin");await claim(a,second);
  outcome=await blockedThenCommit(settle(cancel(b,second)),"claimed work beats cancellation");assert.equal(outcome.error?.code,"40001");
  await a.query("update routine_runs set status='done' where id=$1",[record2.id]);
  const third=randomUUID(),record3=initial();await prepare(a,third,record3);
  await a.query("begin");await cancel(a,third);
  outcome=await blockedThenCommit(settle(claim(b,third)),"prepared cancellation beats claim");assert.equal(outcome.error?.code,"40001");
  assert.equal((await a.query("select status from routine_runs where id=$1",[record3.id])).rows[0].status,"skipped");
  await a.query("update routine_runs set status='waiting_input' where id=$1",[record.id]);
  const input1=randomUUID(),input2=randomUUID(),waiting={...record,status:"waiting_input",inputRevision:0};
  const answers={routineId:routine,runId:record.id,answers:{topic:"synthetic"}};
  await prepare(a,input1,waiting,"input",answers);await prepare(a,input2,waiting,"input",answers);
  await a.query("begin");assert.equal((await claim(a,input1)).rows[0].result,true);
  outcome=await blockedThenCommit(settle(claim(b,input2)),"distinct input requests: only one snapshot claim wins");assert.equal(outcome.error?.code,"40001");
  await a.query("update routine_runs set status='waiting_input' where id=$1",[record.id]);
  assert.equal((await settle(claim(b,input2))).error?.code,"40001");
  assert.equal((await a.query("select input_revision from routine_runs where id=$1",[record.id])).rows[0].input_revision,"1");
  checks.push("identical waiting snapshot cannot bypass monotonic input revision");
  const grants=(await admin.query(`select has_table_privilege('authenticated','manual_routine_requests','select') request_read,
    has_table_privilege('anon','manual_routine_cancellations','insert') cancel_write,
    has_function_privilege('authenticated','claim_manual_routine_request(uuid,uuid,bigint,uuid)','execute') claim_execute`)).rows[0];
  assert(Object.values(grants).every(v=>v===false));checks.push("no anon/member grants on manual tables or claim RPC");
  console.log(JSON.stringify({status:"PASS",at:new Date().toISOString(),postgres:(await admin.query("select version() version")).rows[0].version,
    independentBackendPids:[pidA,pidB],migrationSha256:createHash("sha256").update(migration).digest("hex"),checks,providerCalls:0,productionConnections:0,
    scope:"Exact RPC/editor/guard SQL on a minimal dependency schema; not full Supabase acceptance",retainedTemporaryDirectory:directory},null,2));
} finally {
  for(const c of clients){await c.query("rollback").catch(()=>{});await c.end().catch(()=>{});}
  await cluster.stop();
}
