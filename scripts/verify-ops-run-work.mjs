/** Exact migration, isolated PostgreSQL; no environment files or remote/provider calls. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dependencyDir = process.argv[2];
if (!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated dependency directory required');
const dependencies = createRequire(join(dependencyDir, 'package.json'));
const { default: EmbeddedPostgres } = await import(dependencies.resolve('embedded-postgres'));
const directory = await mkdtemp(join(tmpdir(), 'unc-ops-work-pg-'));
const cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), user: 'postgres', password: randomUUID(),
  authMethod: 'scram-sha-256', port: 55443, persistent: true, createPostgresUser: false,
  initdbFlags: ['--locale=C'], postgresFlags: ['-h','127.0.0.1','-k',directory], onLog: () => {}, onError: () => {} });
const clients = [], checks = [];
const u=randomUUID(), a=randomUUID(), b=randomUUID(), run=randomUUID(), foreignRun=randomUUID(), oldRun=randomUUID();
let admin, reader, locker;
try {
  await cluster.initialise(); await cluster.start(); await cluster.createDatabase('ops_work');
  for (let i=0;i<3;i++) { const c=cluster.getPgClient('ops_work','127.0.0.1'); await c.connect(); await c.query("set statement_timeout='5s'"); clients.push(c); }
  [admin,reader,locker]=clients;
  await admin.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table accounts(id uuid primary key,context_generation bigint);
    create table ops_account_access(user_id uuid,account_id uuid,revoked_at timestamptz,expires_at timestamptz,primary key(user_id,account_id));
    create table routine_runs(id uuid primary key,account_id uuid,context_generation bigint,routine_id text,version int,mode text,status text,started_at timestamptz default now(),finished_at timestamptz,snapshot jsonb);
    create table artifacts(id uuid primary key default gen_random_uuid(),account_id uuid,run_id uuid,routine_id text,kind text,title text,body text,edited_body text,status text,revision bigint default 0,created_at timestamptz default now(),items jsonb default '[]',evidence jsonb default '[]',meta jsonb default '{}');
    create table receipts(id uuid primary key default gen_random_uuid(),account_id uuid,run_id uuid,context_generation bigint,kind text,platform text,description text,created_at timestamptz default now(),payload jsonb default '{}');
    grant usage on schema auth,public to service_role; grant all on all tables in schema public,auth to service_role;`);
  await admin.query(await readFile(new URL('../supabase/migrations/20260905181230_ops_run_work_review.sql',import.meta.url),'utf8'));
  await admin.query('insert into auth.users values($1);',[u]);
  await admin.query('insert into accounts values($1,1),($2,1)',[a,b]);
  await admin.query('insert into ops_account_access(user_id,account_id) values($1,$2)',[u,a]);
  await admin.query("insert into routine_runs(id,account_id,context_generation,routine_id,version,mode,status,snapshot) values($1,$2,1,'D03-W01',1,'dry_run','done','{\"secret\":\"SNAPSHOT_SECRET\"}'),($3,$4,1,'D03-W01',1,'dry_run','done','{}'),($5,$2,0,'D03-W01',1,'dry_run','done','{}')",[run,a,foreignRun,b,oldRun]);
  const execution={accountId:a,runId:run,routineId:'D03-W01',workflowId:'TEST',workflowVersion:'revision',executionId:'123',revisionEvidence:'verified_execution_record',status:'succeeded',executedAction:'none',revisionVerification:{verifiedAt:new Date().toISOString(),token:'VERIFICATION_SECRET'},token:'EXECUTION_SECRET'};
  await admin.query(`insert into artifacts(account_id,run_id,routine_id,kind,title,body,edited_body,status,items,evidence,meta)
    values($1,$2,'D03-W01','keyword_list','Actual output','BUSINESS_BODY','SAVED_EDIT','edited',
    '[{"title":"Item","body":"ITEM_BODY","meta":{"secret":"ITEM_SECRET"}}]',
    '[{"source":"test","ref":"javascript:doNotOpen()","secret":"EVIDENCE_SECRET"}]',$3)`,[a,run,JSON.stringify({executionReceipt:execution,token:'META_SECRET'})]);
  await admin.query("insert into receipts(account_id,run_id,context_generation,kind,description,payload) values($1,$2,1,'draft','Business result',$3)",[a,run,JSON.stringify({externalExecution:execution,secret:'PAYLOAD_SECRET'})]);
  const read=(c=reader,args={})=>c.query('select read_ops_run_work($1,$2,$3,$4,$5,$6) r',[args.u??u,args.a??a,args.run??run,args.af??null,args.rf??null,args.gen??null]).then(r=>r.rows[0].r);
  for(const role of ['anon','authenticated']) { await reader.query(`set role ${role}`); await assert.rejects(read(),{code:'42501'}); }
  checks.push('actual anon and authenticated RPC access denied');
  await reader.query('set role service_role');
  await assert.rejects(read(),{code:'42501'}); checks.push('metadata grant alone cannot read work');
  await admin.query("update ops_account_access set work_read_granted_at=now(),work_read_granted_by=$1,work_read_reason='Isolated synthetic review grant'",[u]);
  let result=await read();
  assert.equal(result.artifacts[0].body,'BUSINESS_BODY'); assert.equal(result.artifacts[0].editedBody,'SAVED_EDIT');
  assert.equal(result.artifacts[0].items[0].body,'ITEM_BODY'); assert.equal(result.receipts[0].execution.executionId,'123');
  assert(!JSON.stringify(result).includes('_SECRET')); assert.equal(result.hasMore,false);
  const audit=(await admin.query('select * from ops_work_reads where id=$1',[result.auditId])).rows[0];
  assert.equal(audit.user_id,u); assert.equal(audit.account_id,a); assert.equal(audit.run_id,run);
  assert.deepEqual(audit.artifact_ids,result.artifacts.map(f=>f.id)); assert.deepEqual(audit.receipt_ids,result.receipts.map(f=>f.id));
  checks.push('business output, saved edits, item text and correlated execution returned; raw secrets excluded','successful access has exact actor/account/run/record audit');
  await assert.rejects(read(reader,{u:randomUUID()}),{code:'42501'});
  await assert.rejects(read(reader,{a:b}),{code:'42501'});
  assert.equal(await read(reader,{run:foreignRun}),null); assert.equal(await read(reader,{run:oldRun}),null);
  await assert.rejects(read(reader,{gen:2}),{code:'22023'});
  await assert.rejects(read(reader,{af:randomUUID(),gen:1}),{code:'22023'});
  await assert.rejects(read(reader,{rf:randomUUID(),gen:1}),{code:'22023'});
  await assert.rejects(read(reader,{af:result.artifactAfter}),{code:'22023'});
  checks.push('unknown actor, foreign account/run, obsolete context and invalid/unbound cursors refused');
  await admin.query("update ops_account_access set revoked_at=now()"); await assert.rejects(read(),{code:'42501'});
  await admin.query("update ops_account_access set revoked_at=null,expires_at=clock_timestamp()-interval '1 second'"); await assert.rejects(read(),{code:'42501'});
  await admin.query('update ops_account_access set expires_at=null'); checks.push('revoked and expired grants refused');
  await admin.query("update artifacts set meta=jsonb_set(meta,'{executionReceipt,accountId}',to_jsonb($1::text))",[b]);
  await admin.query("update receipts set payload=jsonb_set(payload,'{externalExecution,runId}',to_jsonb($1::text))",[foreignRun]);
  result=await read(); assert.equal(result.artifacts[0].execution,null); assert.equal(result.receipts[0].execution,null);
  checks.push('foreign execution claims omitted, not presented as correlated verification');
  // Tied timestamps prove ordering uses IDs rather than a lossy timestamp-only cursor.
  await admin.query("insert into artifacts(account_id,run_id,routine_id,kind,title,body,status) select $1,$2,'D03-W01','generic','Page output','body','draft' from generate_series(1,42)",[a,run]);
  await admin.query("insert into receipts(account_id,run_id,context_generation,kind,description) select $1,$2,1,'draft','Page receipt' from generate_series(1,102)",[a,run]);
  const artifactIds=[],receiptIds=[]; let cursor={}; let pages=0;
  do { result=await read(reader,cursor); artifactIds.push(...result.artifacts.map(f=>f.id));receiptIds.push(...result.receipts.map(f=>f.id));
    cursor={af:result.artifactAfter,rf:result.receiptAfter,gen:1}; if(++pages>10) throw Error('Pagination loop');
  } while(result.hasMore);
  assert.equal(artifactIds.length,43);assert.equal(new Set(artifactIds).size,43);assert.equal(receiptIds.length,103);assert.equal(new Set(receiptIds).size,103);
  checks.push('three keyset pages return every artifact and receipt exactly once');
  await admin.query('revoke insert on ops_work_reads from service_role'); await assert.rejects(read(),{code:'42501'});
  await admin.query('grant insert on ops_work_reads to service_role'); checks.push('audit failure prevents work disclosure');
  async function waitForLock() { for(let i=0;i<100;i++){const r=await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[reader.processID]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('No observed lock wait');}
  for(const kind of ['revoke','context','expiry']) {
    await admin.query('update accounts set context_generation=1; update ops_account_access set revoked_at=null,expires_at=null');
    await locker.query('begin');
    if(kind==='context') await locker.query('update accounts set context_generation=2 where id=$1',[a]);
    else if(kind==='revoke') await locker.query('update ops_account_access set revoked_at=now()');
    else await locker.query("update ops_account_access set expires_at=clock_timestamp()+interval '150 milliseconds'");
    const pending=read().then(r=>({r}),e=>({e})); await waitForLock();
    if(kind==='expiry') await locker.query('select pg_sleep(0.2)');
    await locker.query('commit'); const outcome=await pending;
    if(kind==='context') assert.equal(outcome.r,null); else assert.equal(outcome.e.code,'42501');
    checks.push('observed concurrent '+kind+' locks out stale authorization');
  }
  const acl=(await admin.query("select prosecdef,provolatile,proconfig from pg_proc where oid='read_ops_run_work(uuid,uuid,uuid,uuid,uuid,bigint)'::regprocedure")).rows[0];
  assert.deepEqual(acl,{prosecdef:false,provolatile:'v',proconfig:['search_path=""']});
  checks.push('volatile security-invoker, empty search path, no definer escalation');
  console.log(JSON.stringify({status:'PASS',checks,providerCalls:0,remoteDatabaseCalls:0},null,2));
} finally { for(const c of clients) await c.end().catch(()=>{}); await cluster.stop().catch(()=>{}); }
