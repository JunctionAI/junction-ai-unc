/** Offline PostgreSQL smoke test. Usage:
 * node scripts/verify-command-schema.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
 * PGlite is installed in a temporary directory, not added to production dependencies.
 * This tests the NEW migration on minimal referenced tables, not the entire deployed schema.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table accounts (id uuid primary key);
    create table channel_links (id uuid primary key, channel text check (channel in ('telegram','whatsapp','slack','sms','email')));
    create table chat_messages (id uuid primary key, channel text check (channel in ('app','telegram','whatsapp','slack','sms','email')));
    create table outbound_messages (id uuid primary key, channel text check (channel in ('telegram','whatsapp','slack','sms','email')));
    insert into auth.users values ('10000000-0000-0000-0000-000000000001');
    insert into accounts values ('20000000-0000-0000-0000-000000000001');
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260904011301_routine_command_queue.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../supabase/migrations/20260904023448_apple_channel_preparation.sql", import.meta.url), "utf8"));
  for (const table of ["channel_links", "chat_messages", "outbound_messages"]) {
    await db.exec(`insert into ${table} values ('40000000-0000-0000-0000-000000000001','apple')`);
    await assert.rejects(db.exec(`insert into ${table} values ('40000000-0000-0000-0000-000000000002','invalid')`), /check constraint/);
  }
  const perms = await db.query(`select rolname,
    has_table_privilege(rolname, 'routine_commands', 'SELECT') as read_commands,
    has_table_privilege(rolname, 'routine_commands', 'INSERT') as write_commands,
    has_table_privilege(rolname, 'channel_inbox', 'SELECT') as read_inbox,
    has_table_privilege(rolname, 'channel_inbox', 'INSERT') as write_inbox
    from pg_roles where rolname in ('anon', 'authenticated', 'service_role') order by rolname`);
  for (const row of perms.rows) {
    for (const key of ["read_commands", "write_commands", "read_inbox", "write_inbox"]) assert.equal(row[key], row.rolname === "service_role", `${row.rolname}.${key}`);
  }
  const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('routine_commands', 'channel_inbox')");
  assert.equal(rls.rows.length, 2);
  assert(rls.rows.every((r) => r.relrowsecurity));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["routine_commands", "channel_inbox"]) {
      await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      await assert.rejects(db.query(`delete from ${table}`), /permission denied/);
    }
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await db.exec(`insert into routine_commands
    (id,account_id,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','app','message-1','hash','D01-W01','spec','workflow',1,'Run founder content','queued','Queued')`);
  const first = await db.query("update routine_commands set status='running' where status='queued' returning id");
  await db.exec("update routine_commands set channel='apple'");
  const second = await db.query("update routine_commands set status='running' where status='queued' returning id");
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 0);
  await assert.rejects(db.exec("update routine_commands set status='invented'"), /check constraint/);
  await db.exec("insert into channel_inbox (id,channel,event,status) values ('evt','slack','{}','queued')");
  await assert.rejects(db.exec("insert into channel_inbox (id,channel,event,status) values ('evt','slack','{}','queued')"), /duplicate key/);
  console.log("PASS: queue + Apple compatibility migrations; queue RLS enabled; anon/member denied; service role allowed; single claim; channel/status constraints; duplicate event rejection. Minimal local schema only, not target-database proof.");
} finally { await db.close(); }
