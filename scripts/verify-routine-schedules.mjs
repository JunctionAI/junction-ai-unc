/** Real isolated PostgreSQL, no production env, n8n, Slack or provider calls. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const deps=process.argv[2];
if(!deps?.startsWith('/tmp/unc-manual-pg.'))throw Error('Explicit isolated dependency directory required');
const require=createRequire(import.meta.url),dependencies=createRequire(join(deps,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const {scheduleCommand}=require('../dist/worker/lib/commands/schedule.js');
const directory=await mkdtemp(join(tmpdir(),'unc-schedules-pg-'));
const pg=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55443,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[];const checks=[];
try{
 await pg.initialise();await pg.start();await pg.createDatabase('schedule_acceptance');
 for(let i=0;i<3;i++){const c=pg.getPgClient('schedule_acceptance','127.0.0.1');await c.connect();clients.push(c);}
 const [admin,a,b]=clients;
 await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean);
 create table account_members(account_id uuid,user_id uuid,role text);
 create table routine_states(account_id uuid,routine_id text,version integer,enabled boolean);
 create table routine_commands(id uuid primary key,account_id uuid,context_generation bigint,user_id uuid,channel text,request_id text,
 link_id uuid,channel_binding jsonb,request_hash text,routine_id text,spec_hash text,workflow_hash text,version integer,request text,
 status text,reply text,run_id uuid,created_at timestamptz,updated_at timestamptz);
 create function public.verify_channel_inbound_binding(jsonb,jsonb,boolean) returns jsonb language sql as 'select $1';
 create function public.keyword_command_origin_valid(c public.routine_commands) returns boolean language plpgsql as $$ begin if c.channel='app' then return true; end if;return false;end $$;
 grant usage on schema public to service_role;grant select,insert,update on all tables in schema public to service_role;`);
 await admin.query(await readFile(new URL('../supabase/migrations/20260906032004_routine_schedules.sql',import.meta.url),'utf8'));
 const A=randomUUID(),U=randomUUID();
 await admin.query('insert into auth.users values($1)',[U]);
 await admin.query('insert into accounts values($1,1,false)',[A]);
 await admin.query("insert into account_members values($1,$2,'owner')",[A,U]);
 await admin.query("insert into routine_states values($1,'D03-W01',2,true)",[A]);
 const now=new Date(),slot=new Date(Math.floor(now.getTime()/60000)*60000),date=slot.toISOString().slice(0,10);
 const row=(await admin.query(`insert into routine_schedules(account_id,context_generation,user_id,routine_id,version,spec_hash,workflow_hash,
 enabled,timezone,hour,minute,channel) values($1,1,$2,'D03-W01',2,$3,$4,true,'UTC',$5,$6,'app') returning *`,[A,U,'a'.repeat(64),'b'.repeat(64),slot.getUTCHours(),slot.getUTCMinutes()])).rows[0];
 // Fixture-only clock: production writes cannot backdate starts_at.
 await admin.query('alter table routine_schedules disable trigger routine_schedule_guard');
 await admin.query("update routine_schedules set starts_at=now()-interval '1 minute'");
 await admin.query('alter table routine_schedules enable trigger routine_schedule_guard');
 const s={id:row.id,revision:0,accountId:A,contextGeneration:1,userId:U,routineId:'D03-W01',version:2,specHash:'a'.repeat(64),workflowHash:'b'.repeat(64),actor:{accountId:A,userId:U,channel:'app',contextGeneration:1}};
 const c=scheduleCommand(s,{at:slot.toISOString(),localDate:date},new Date());
 const input={scheduleId:s.id,revision:0,slotAt:slot.toISOString(),localDate:date,command:{id:c.id,account_id:A,context_generation:1,user_id:U,
 routine_id:c.routineId,version:2,spec_hash:c.specHash,workflow_hash:c.workflowHash,channel:'app',channel_binding:null,link_id:null,
 request_id:c.actor.requestId,request:c.request,request_hash:c.requestHash,status:c.status,reply:c.reply,created_at:c.createdAt,updated_at:c.updatedAt}};
 for(const client of [a,b])await client.query('set role service_role');
 const results=await Promise.all([a,b].map(client=>client.query('select claim_routine_schedule($1) ok',[input])));
 assert.equal(results.filter(r=>r.rows[0].ok).length,1);checks.push('concurrent slot claimed once');
 assert.equal((await admin.query('select count(*)::int n from routine_commands')).rows[0].n,1);checks.push('one durable command');
 const current=()=>a.query('select routine_scheduled_command_current($1,$2,$3) ok',[c.actor.requestId,A,U]);
 assert.equal((await current()).rows[0].ok,true);checks.push('owned saved schedule admitted');
 assert.equal((await a.query('select routine_scheduled_command_current($1,$2,$3) ok',[c.actor.requestId,randomUUID(),U])).rows[0].ok,false);checks.push('foreign account refused');
 await admin.query('update routine_states set enabled=false');assert.equal((await current()).rows[0].ok,false);checks.push('routine off revokes');
 await admin.query('update routine_states set enabled=true');
 await admin.query('update routine_schedules set enabled=false');assert.equal((await current()).rows[0].ok,false);checks.push('schedule off revokes');
 assert.equal((await a.query('select claim_routine_schedule($1) ok',[input])).rows[0].ok,false);checks.push('old revision cannot enqueue');
 const acl=(await admin.query("select has_table_privilege('anon','routine_schedules','select') a,has_function_privilege('authenticated','claim_routine_schedule(jsonb)','execute') b")).rows[0];
 assert.equal(acl.a,false);assert.equal(acl.b,false);checks.push('public roles denied');
 console.log(JSON.stringify({status:'PASS',checks,externalCalls:0}));
}finally{for(const c of clients)await c.end().catch(()=>{});await pg.stop().catch(()=>{});}
