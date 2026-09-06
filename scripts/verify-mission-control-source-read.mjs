/** Exact source-read migration in isolated PostgreSQL. No network/provider calls. */
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
const directory=await mkdtemp(join(tmpdir(),'unc-mission-source-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',port:55447,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[];let admin,reader;
const account=randomUUID(),other=randomUUID();
try{
  await cluster.initialise();await cluster.start();await cluster.createDatabase('mission_source');
  for(let i=0;i<2;i++){const c=cluster.getPgClient('mission_source','127.0.0.1');await c.connect();clients.push(c);}
  [admin,reader]=clients;
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;create schema junction;create schema h1;create schema dbh;
    create table h1.email_campaigns(id uuid primary key,campaign_id text,message_id text,name text,subject text,preview_text text,sent_at timestamptz,segment text,recipients integer,open_rate numeric,click_rate numeric,placed_order_rate numeric,unsubscribe_rate numeric,spam_rate numeric,bounce_rate numeric,revenue numeric,metrics_updated_at timestamptz,updated_at timestamptz);
    create table dbh.email_campaigns(like h1.email_campaigns including all);
    grant usage on schema public,junction,h1,dbh to service_role;grant select on h1.email_campaigns,dbh.email_campaigns to service_role;`);
  await admin.query(await readFile(new URL('../integrations/mission-control/supabase/migrations/20260906010000_unc_source_read_contract.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../integrations/mission-control/supabase/migrations/20260906012000_unc_source_read_definer.sql',import.meta.url),'utf8'));
  await admin.query("insert into junction.unc_source_read_grants(account_id,source_project,source_kind,source_key,warehouse_schema,dataset,granted_by,reason) values($1,'ebcatvidixdjjwmmades','junction.client_orgs','h1','h1','email_campaigns','isolated verifier','Exact isolated source grant')",[account]);
  await admin.query("insert into h1.email_campaigns(id,campaign_id,name,subject,sent_at,recipients,open_rate,revenue,metrics_updated_at,updated_at) values($1,'campaign-1','Sent one','Subject one','2026-09-05T00:00:00Z',100,0.5,250,'2026-09-05T01:00:00Z','2026-09-05T01:00:00Z'),($2,'campaign-2','Draft','Draft subject',null,0,0,0,now(),now())",[randomUUID(),randomUUID()]);
  const args=[account,'ebcatvidixdjjwmmades','junction.client_orgs','h1',500];
  for(const role of ['anon','authenticated']){await reader.query(`set role ${role}`);await assert.rejects(reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5)',args),{code:'42501'});}
  await reader.query('set role service_role');
  const value=(await reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5) value',args)).rows[0].value;
  assert.equal(value.contract,'junction.source.email-campaigns.v1');assert.equal(value.accountId,account);assert.equal(value.sourceRowCount,1);assert.equal(value.rows.length,1);assert.equal(value.rows[0].subject,'Subject one');assert(!Object.hasOwn(value.rows[0],'raw'));assert(!Object.hasOwn(value.rows[0],'copyText'));
  await assert.rejects(reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5)',[other,...args.slice(1)]),{code:'42501'});
  await assert.rejects(reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5)',[account,'ebcatvidixdjjwmmades','junction.client_orgs','dbh',500]),{code:'42501'});
  await assert.rejects(reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5)',[...args.slice(0,4),501]),{code:'22023'});
  await admin.query('update junction.unc_source_read_grants set revoked_at=now() where account_id=$1',[account]);
  await assert.rejects(reader.query('select public.read_unc_source_email_campaigns($1,$2,$3,$4,$5)',args),{code:'42501'});
  const acl=(await admin.query("select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') server,has_table_privilege('service_role','h1.email_campaigns','select') h1_direct,has_table_privilege('service_role','dbh.email_campaigns','select') dbh_direct from pg_proc p where p.proname='read_unc_source_email_campaigns'")).rows[0];
  assert(acl.prosecdef&&acl.proconfig?.includes('search_path=""')&&!acl.anon&&!acl.authenticated&&acl.server&&!acl.h1_direct&&!acl.dbh_direct);
  console.log(JSON.stringify({status:'PASS',checks:['browser roles refused','exact account and source identity','sent campaigns only','no raw or message copy','bounded rows','revocation','service-only definer function','no direct service-role campaign-table read'],providerCalls:0,remoteDatabaseCalls:0},null,2));
}finally{for(const c of clients)await c.end().catch(()=>{});await cluster.stop().catch(()=>{});}
