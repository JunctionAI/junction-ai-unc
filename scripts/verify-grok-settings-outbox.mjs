// Actual local PostgreSQL-WASM transactions. No hosted writes or network calls.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.env.REVIEW_PGLITE_MODULE).href);
const db = new PGlite(); let checks = 0;
const account = randomUUID(), actor = randomUUID(), other = randomUUID();
async function refused(sql, params = []) { await assert.rejects(db.query(sql, params)); checks++; }
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to service_role;
 create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean);
 create table account_members(account_id uuid,user_id uuid,role text);
 create table routine_states(account_id uuid,routine_id text,enabled boolean,updated_at timestamptz default now(),primary key(account_id,routine_id));
 create table routine_runs(id uuid primary key default gen_random_uuid(),account_id uuid,routine_id text,status text);
 grant select,insert,update on accounts,account_members,routine_states,routine_runs to service_role;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908171415_grok_control_records.sql', import.meta.url), 'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260908175112_grok_settings_outbox.sql', import.meta.url), 'utf8'));
 await db.query('insert into accounts values($1,0,true),($2,0,true)', [account,other]);
 await db.query("insert into account_members values($1,$2,'owner')", [account,actor]);
 await db.query("insert into routine_states(account_id,routine_id,enabled) values($1,'D02-W01',false)", [account]);
 await db.exec('set role service_role');
 const bind = `insert into grok_routine_settings(account_id,routine_id,context_generation,worker_id,binding_evidence) values($1,'D02-W01',0,'test-worker','synthetic test only')`;
 await db.query('update accounts set automation_paused=false where id=$1',[account]);
 await refused(bind,[account]);
 await db.query('update accounts set automation_paused=true where id=$1',[account]);
 await db.query("update routine_states set enabled=true where account_id=$1",[account]);
 await refused(bind,[account]);
 await db.query("update routine_states set enabled=false where account_id=$1",[account]);
 await db.query("insert into routine_runs(account_id,routine_id,status) values($1,'D02-W01','running')",[account]);
 await refused(bind,[account]);
 await db.query("update routine_runs set status='done'");
 await db.query(bind,[account]);checks++;
 await refused("update routine_states set enabled=true where account_id=$1",[account]);
 await refused("insert into routine_runs(account_id,routine_id,status) values($1,'D02-W01','running')",[account]);
 // Unbound routines remain available to the existing worker.
 await db.query("insert into routine_runs(account_id,routine_id,status) values($1,'D03-W01','running')",[account]);checks++;
 await refused("insert into routine_runs(account_id,routine_id,status,scheduling_owner) values($1,'D03-W01','running','grok')",[account]);
 const call = 'select set_grok_agent_settings($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
 const changeId = randomUUID();
 const args = [account,actor,0,'D02-W01',true,'08:00','Pacific/Auckland',0,changeId];
 await refused(call,args); // paused cannot enable
 await db.query('update accounts set automation_paused=false where id=$1',[account]);
 await refused(call,[account,other,...args.slice(2)]);
 await refused(call,[account,actor,1,...args.slice(3)]);
 await refused(call,[...args.slice(0,6),'not/a/timezone',0,randomUUID()]);
 const saved = (await db.query(call,args)).rows[0].result;
 assert.equal(saved.duplicate,false); assert.equal(saved.change.enabled,true);checks++;
 await db.query("insert into grok_control_records(id,account_id,context_generation,kind,platform,description,payload) values($1,$2,0,'notification','grok_control_request','local SQL test',$3)",[changeId,account,{change:saved.change}]);checks++;
 assert.equal((await db.query('select enabled from routine_states where account_id=$1',[account])).rows[0].enabled,false);checks++;
 const retry = (await db.query(call,args)).rows[0].result;
 assert.equal(retry.duplicate,true);assert.deepEqual(retry.change,saved.change);checks++;
 await refused(call,[...args.slice(0,8),randomUUID()]); // stale revision
 await refused(call,[...args.slice(0,4),false,...args.slice(5)]); // conflicting reuse
 // Force the outbox insert to fail after the settings UPDATE: both must roll back.
 await db.exec("reset role;create function test_outbox_failure() returns trigger language plpgsql as $$begin raise exception 'test failure';end$$;create trigger test_failure before insert on grok_settings_outbox for each row execute function test_outbox_failure();set role service_role;");
 await refused(call,[...args.slice(0,4),false,'09:00','UTC',1,randomUUID()]);
 assert.equal(Number((await db.query('select revision from grok_routine_settings')).rows[0].revision),1);checks++;
 await db.exec('reset role;drop trigger test_failure on grok_settings_outbox;set role service_role;');
 await db.query('update accounts set automation_paused=true where id=$1',[account]);
 const stop = (await db.query(call,[...args.slice(0,4),false,'09:00','UTC',1,randomUUID()])).rows[0].result;
 assert.equal(stop.change.enabled,false);checks++;
 // Old request remains immutable and is explicitly superseded.
 const oldArgs=[...args];oldArgs[4]=true;
 await db.query('update accounts set automation_paused=false where id=$1',[account]);
 assert.equal((await db.query(call,oldArgs)).rows[0].result.superseded,true);checks++;
 assert.equal(Number((await db.query('select count(*) n from grok_settings_outbox')).rows[0].n),2);checks++;
 await refused("update grok_settings_outbox set revision=99");
 await refused("update grok_routine_settings set worker_id='foreign'");
 const grants=(await db.query("select has_table_privilege('anon','grok_routine_settings','select') a,has_table_privilege('authenticated','grok_settings_outbox','select') b,has_function_privilege('authenticated','set_grok_agent_settings(uuid,uuid,bigint,text,boolean,text,text,bigint,uuid)','execute') c")).rows[0];
 assert.ok(Object.values(grants).every(v=>!v));checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'local actual SQL; no concurrent backends or native Grok proof',externalCalls:0}));
} finally { await db.close(); }
