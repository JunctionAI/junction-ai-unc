/** Real local PostgreSQL only; exact history function + rollback canary on minimal
 * dependency tables. Never loads production credentials or contacts a provider. */
import {readFile,mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated PostgreSQL dependency directory required');
const require=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(require.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'unc-history-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55440,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
let client;
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase('history_acceptance');
  client=cluster.getPgClient('history_acceptance','127.0.0.1');await client.connect();
  const read=p=>readFile(new URL(p,import.meta.url),'utf8');
  const base=await read('../supabase/migrations/0001_init.sql'),artifacts=await read('../supabase/migrations/0013_artifacts.sql');
  const table=(source,name)=>{const match=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));if(!match)throw Error('Missing table');return match[0];};
  await client.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    ${['accounts','account_members','routine_runs','approvals','receipts'].map(t=>table(base,t)).join('\n')}
    ${table(artifacts,'artifacts')}
    alter table accounts add column context_generation bigint not null default 0,add column automation_paused boolean not null default false;
    alter table routine_runs add column context_generation bigint not null default 0,add column snapshot jsonb,add column spec_hash text,add column dedup_key text;
    alter table approvals add column context_generation bigint not null default 0;
    alter table receipts add column context_generation bigint not null default 0;
    grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;
    insert into auth.users values('74802c60-149a-4405-b719-dc058d174072');
    insert into accounts(id,name) values('aa5cfc84-2569-4c99-9b40-67003ae55eda','Local only seed');
    insert into account_members(account_id,user_id,role) values('aa5cfc84-2569-4c99-9b40-67003ae55eda','74802c60-149a-4405-b719-dc058d174072','owner');`);
  await client.query(await read('../supabase/migrations/20260905143724_workspace_history.sql'));
  const grants=(await client.query(`select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('authenticated',p.oid,'execute') member,has_function_privilege('service_role',p.oid,'execute') server
    from pg_proc p where p.proname='read_workspace_history'`)).rows[0];
  assert.deepEqual(grants,{prosecdef:false,anon:false,member:false,server:true});
  await client.query('begin');
  const result=await client.query(await read('./verify-workspace-history.sql'));
  await client.query('rollback');
  assert.equal(Number((await client.query('select count(*) from accounts')).rows[0].count),1);
  console.log(JSON.stringify({status:'PASS',grants,canary:result.at(-1).rows[0].history_canary,rolledBack:true,providerCalls:0}));
} finally {await client?.end();await cluster.stop();}
