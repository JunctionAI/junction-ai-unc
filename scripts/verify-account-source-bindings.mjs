/** Exact migration in isolated PostgreSQL. No environment, network or provider access. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/private/tmp/unc-manual-pg.')&&!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'unc-source-bindings-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',port:55446,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[];let admin,operator;
const actor=randomUUID(),peer=randomUUID(),a=randomUUID(),b=randomUUID();
try{
  await cluster.initialise();await cluster.start();await cluster.createDatabase('source_bindings');
  for(let i=0;i<2;i++){const c=cluster.getPgClient('source_bindings','127.0.0.1');await c.connect();clients.push(c);}
  [admin,operator]=clients;
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create table public.accounts(id uuid primary key,context_generation bigint not null default 0,automation_paused boolean not null default false);
    create table public.ops_account_access(user_id uuid,account_id uuid,granted_at timestamptz default now(),granted_by uuid not null,reason text not null,revoked_at timestamptz,expires_at timestamptz,primary key(user_id,account_id));
    grant usage on schema auth,public to service_role;grant all on all tables in schema auth,public to service_role;`);
  await admin.query(await readFile(new URL('../supabase/migrations/20260906002000_account_source_bindings.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../supabase/migrations/20260906011000_ops_source_read_authority.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../supabase/migrations/20260906011200_source_read_status.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../supabase/migrations/20260906013000_source_dataset_runtime_grants.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../supabase/migrations/20260906013200_source_dataset_grant_guard.sql',import.meta.url),'utf8'));
  await admin.query('insert into auth.users values($1),($2)',[actor,peer]);
  await admin.query('insert into accounts values($1,1),($2,1)',[a,b]);
  await admin.query("insert into ops_account_access(user_id,account_id,granted_by,reason,source_binding_granted_at,source_binding_granted_by,source_binding_reason,source_read_granted_at,source_read_granted_by,source_read_reason) values($1,$2,$1,'Isolated operator read grant',now(),$1,'Isolated source binding grant',now(),$1,'Isolated source read grant'),($1,$3,$1,'Isolated operator read grant',now(),$1,'Isolated source binding grant',now(),$1,'Isolated source read grant')",[actor,a,b]);
  const args=[actor,a,1,'mission_control','ebcatvidixdjjwmmades','public.client_accounts','source-1','Client A','verified','isolated source row evidence',null];
  for(const role of ['anon','authenticated']){await operator.query(`set role ${role}`);await assert.rejects(operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',args),{code:'42501'});}
  await operator.query('set role service_role');
  let saved=(await operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',args)).rows[0].value;
  assert.equal(saved.accountId,a);assert.equal(saved.revision,0);assert.equal(saved.status,'verified');
  await assert.rejects(operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[...args.slice(0,1),b,...args.slice(2)]),{code:'23505'});
  await assert.rejects(operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[...args.slice(0,2),2,...args.slice(3)]),{code:'PT409'});
  await assert.rejects(operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',args),{code:'40001'});
  const update=[...args];update[7]='Client A renamed';update[10]=0;
  saved=(await operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',update)).rows[0].value;
  assert.equal(saved.displayName,'Client A renamed');assert.equal(saved.revision,1);
  await admin.query("insert into account_source_dataset_grants(account_id,context_generation,binding_id,platform,dataset,source_contract,max_source_age_minutes,granted_by,reason) values($1,1,$2,'klaviyo','email_campaigns','junction.source.email-campaigns.v1',1440,$3,'Isolated runtime stored source grant')",[a,saved.id,actor]);
  await assert.rejects(admin.query("insert into account_source_dataset_grants(account_id,context_generation,binding_id,platform,dataset,source_contract,max_source_age_minutes,granted_by,reason) values($1,1,$2,'klaviyo','email_campaigns','junction.source.email-campaigns.v1',1440,$3,'Mismatched isolated source grant')",[b,saved.id,actor]),{code:'23514'});
  const runtime=(await operator.query("select public.authorize_account_source_dataset_read($1,1,'klaviyo','email_campaigns') value",[a])).rows[0].value;
  assert.equal(runtime.accountId,a);assert.equal(runtime.bindingId,saved.id);assert.equal(runtime.maxSourceAgeMinutes,1440);
  for(const role of ['anon','authenticated']){await operator.query(`set role ${role}`);await assert.rejects(operator.query("select public.authorize_account_source_dataset_read($1,1,'klaviyo','email_campaigns')",[a]),{code:'42501'});}
  await operator.query('set role service_role');
  await assert.rejects(operator.query("select public.authorize_account_source_dataset_read($1,2,'klaviyo','email_campaigns')",[a]),{code:'PT409'});
  await admin.query('update accounts set automation_paused=true where id=$1',[a]);
  await assert.rejects(operator.query("select public.authorize_account_source_dataset_read($1,1,'klaviyo','email_campaigns')",[a]),{code:'PT409'});
  await admin.query('update accounts set automation_paused=false where id=$1',[a]);
  await assert.rejects(admin.query('update account_source_dataset_grants set max_source_age_minutes=60 where account_id=$1',[a]),{code:'23514'});
  let read=(await operator.query('select public.read_ops_account_source_bindings($1,$2) value',[actor,a])).rows[0].value;
  assert.equal(read.length,1);assert.equal(read[0].sourceKey,'source-1');assert.equal(read[0].sourceReadAuthorized,true);
  const authorized=(await operator.query('select public.authorize_ops_account_source_read($1,$2,$3,$4) value',[actor,a,1,saved.id])).rows[0].value;
  assert.equal(authorized.id,saved.id);assert.equal(authorized.accountId,a);
  await assert.rejects(operator.query('select public.authorize_ops_account_source_read($1,$2,$3,$4)',[peer,a,1,saved.id]),{code:'42501'});
  await assert.rejects(operator.query('select public.authorize_ops_account_source_read($1,$2,$3,$4)',[actor,a,2,saved.id]),{code:'PT409'});
  await assert.rejects(operator.query('select public.read_ops_account_source_bindings($1,$2)',[peer,a]),{code:'42501'});
  await admin.query('update ops_account_access set source_read_granted_at=null,source_read_granted_by=null,source_read_reason=null where account_id=$1',[a]);
  await assert.rejects(operator.query('select public.authorize_ops_account_source_read($1,$2,$3,$4)',[actor,a,1,saved.id]),{code:'42501'});
  read=(await operator.query('select public.read_ops_account_source_bindings($1,$2) value',[actor,a])).rows[0].value;
  assert.equal(read[0].sourceReadAuthorized,false);
  await admin.query('update ops_account_access set source_binding_granted_at=null,source_binding_granted_by=null,source_binding_reason=null where account_id=$1',[a]);
  await assert.rejects(operator.query('select public.upsert_ops_account_source_binding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',update),{code:'42501'});
  await admin.query('update ops_account_access set revoked_at=now() where account_id=$1',[a]);
  await assert.rejects(operator.query('select public.read_ops_account_source_bindings($1,$2)',[actor,a]),{code:'42501'});
  await admin.query('update account_source_dataset_grants set revoked_at=now(),revoked_by=$2,revoke_reason=$3 where account_id=$1',[a,actor,'Isolated runtime revocation check']);
  await assert.rejects(operator.query("select public.authorize_account_source_dataset_read($1,1,'klaviyo','email_campaigns')",[a]),{code:'42501'});
  const acl=(await admin.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') server from pg_proc p where p.proname in ('upsert_ops_account_source_binding','read_ops_account_source_bindings','authorize_ops_account_source_read','authorize_account_source_dataset_read') order by p.proname")).rows;
  assert(acl.every(x=>!x.prosecdef&&x.proconfig?.includes('search_path=""')&&!x.anon&&!x.authenticated&&x.server));
  console.log(JSON.stringify({status:'PASS',checks:['browser roles refused','exact account and generation required','one source cannot bind two accounts','compare-and-swap update','separate operator source-read authority','separate runtime dataset authority','cross-account runtime grant refused','runtime authority immutable','paused and stale-generation runtime refusal','runtime grant revocation','unknown and revoked operators refused','service-only invoker functions'],providerCalls:0,remoteDatabaseCalls:0},null,2));
}finally{for(const c of clients)await c.end().catch(()=>{});await cluster.stop().catch(()=>{});}
