/** Isolated PostgreSQL tests of the exact migration. Synthetic data only; no
 * environment loading, remote database, credentials, provider or n8n calls. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dependencyDir = process.argv[2];
if (!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated PostgreSQL dependency directory required');
const dependencies = createRequire(join(dependencyDir, 'package.json'));
const { default: EmbeddedPostgres } = await import(dependencies.resolve('embedded-postgres'));
const directory = await mkdtemp(join(tmpdir(), 'unc-dataset-fence-pg-'));
const cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), user: 'postgres', password: randomUUID(),
  authMethod: 'scram-sha-256', port: 55443, persistent: true, createPostgresUser: false,
  initdbFlags: ['--locale=C'], postgresFlags: ['-h', '127.0.0.1', '-k', directory], onLog: () => {}, onError: () => {} });
const clients = [], checks = [];
const account = randomUUID(), connector = randomUUID(), hash = 'a'.repeat(64);
const key = `dataset:${account}:${connector}:${hash}`;
const migration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
let admin, a, b;
try {
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('dataset_fence_acceptance');
  for (let i = 0; i < 3; i++) {
    const c = cluster.getPgClient('dataset_fence_acceptance', '127.0.0.1');
    await c.connect();
    await c.query("set statement_timeout='5s'");
    clients.push(c);
  }
  [admin, a, b] = clients;
  await admin.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.accounts(id uuid primary key,context_generation bigint not null,automation_paused boolean not null);
    create table public.connectors(id uuid primary key,account_id uuid not null references accounts(id),
      platform text not null,external_ref text,status text not null);
    grant usage on schema public to service_role,anon,authenticated;
    grant select,insert,update,delete on public.accounts,public.connectors to service_role;`);
  await admin.query(await migration('20260905021314_backend_data_foundation.sql'));
  await admin.query(await migration('20260905165333_dataset_sync_commit_fence.sql'));
  await admin.query('insert into accounts values($1,1,false)', [account]);
  await admin.query("insert into connectors values($1,$2,'meta_ads','act_SYNTHETIC','connected')", [connector, account]);
  const acl = (await admin.query(`select prosecdef,proconfig,
    has_function_privilege('anon',oid,'execute') anon,
    has_function_privilege('authenticated',oid,'execute') member,
    has_function_privilege('service_role',oid,'execute') server
    from pg_proc where oid='public.commit_dataset_sync(jsonb,uuid,bigint)'::regprocedure`)).rows[0];
  assert.deepEqual(acl, { prosecdef: false, proconfig: ['search_path=""'], anon: false, member: false, server: true });
  checks.push('service-only security-invoker RPC with empty search path');
  for (const role of ['anon', 'authenticated']) {
    await a.query(`set role ${role}`);
    await assert.rejects(a.query("select public.commit_dataset_sync('{}',null,null)"), { code: '42501' });
  }
  await a.query('set role service_role');
  await b.query('set role service_role');
  checks.push('actual anon and authenticated calls denied');

  const commit = (c, snapshot, holder, generation = 1) => c.query(
    'select public.commit_dataset_sync($1::jsonb,$2::uuid,$3::bigint) stored_at', [JSON.stringify(snapshot), holder, generation]
  ).then(r => r.rows[0].stored_at);
  const count = () => admin.query('select count(*)::int n from account_dataset_snapshots').then(r => r.rows[0].n);
  async function fixture() {
    await admin.query('delete from account_dataset_snapshots; delete from backend_leases');
    await admin.query('update accounts set context_generation=1,automation_paused=false');
    await admin.query("update connectors set external_ref='act_SYNTHETIC',status='connected'");
    const holder = randomUUID(), now = new Date().toISOString();
    assert.equal((await a.query('select claim_backend_lease($1,$2,120) ok', [key, holder])).rows[0].ok, true);
    return { holder, snapshot: { id: randomUUID(), account_id: account, connector_id: connector,
      platform: 'meta_ads', external_ref: 'act_SYNTHETIC', query_hash: hash, query: { resource: 'insights' },
      source_fetched_at: now, stored_at: '2099-01-01T00:00:00Z',
      result: { rows: [{ spend: 17 }], metrics: { spend: 17 }, provenance: 'ok', fetchedAt: now } } };
  }
  let f = await fixture();
  const stored = await commit(a, f.snapshot, f.holder);
  assert(stored instanceof Date);
  const saved = (await admin.query('select * from account_dataset_snapshots')).rows[0];
  assert.deepEqual(saved.result, f.snapshot.result);
  assert.equal(saved.source_fetched_at.toISOString(), f.snapshot.source_fetched_at);
  assert.equal(saved.stored_at.toISOString(), stored.toISOString());
  assert(Math.abs(Date.now() - stored.getTime()) < 5000);
  assert.equal((await admin.query('select count(*)::int n from backend_leases')).rows[0].n, 0);
  assert.equal(await commit(a, { ...f.snapshot, id: randomUUID() }, f.holder), null);
  assert.equal(await count(), 1);
  checks.push('valid completion preserves source data and uses server storage time', 'successful completion consumes lease and refuses replay');

  for (const [name, mutate, override = {}] of [
    ['expired holder', () => admin.query("update backend_leases set expires_at=clock_timestamp()-interval '1 second'")],
    ['missing lease', () => admin.query('delete from backend_leases')],
    ['successor holder', () => admin.query('update backend_leases set holder=$1', [randomUUID()])],
    ['paused account', () => admin.query('update accounts set automation_paused=true')],
    ['changed context generation', () => admin.query('update accounts set context_generation=2')],
    ['disconnected connector', () => admin.query("update connectors set status='disconnected'")],
    ['rebound external asset', () => admin.query("update connectors set external_ref='act_OTHER'")],
    ['foreign account', async () => {}, { account_id: randomUUID() }],
    ['foreign connector', async () => {}, { connector_id: randomUUID() }],
    ['wrong query lease', async () => {}, { query_hash: 'b'.repeat(64) }],
  ]) {
    f = await fixture(); await mutate();
    assert.equal(await commit(a, { ...f.snapshot, ...override }, f.holder), null, name);
    assert.equal(await count(), 0, name);
    checks.push(name + ' refused without insertion');
  }

  for (const [name, change] of [
    ['fixture provenance', s => { s.result.provenance = 'fixture'; }],
    ['missing source evidence', s => { delete s.result.fetchedAt; }],
    ['different source timestamp', s => { s.result.fetchedAt = '2001-01-01T00:00:00Z'; }],
    ['stale observation', s => { s.source_fetched_at = s.result.fetchedAt = new Date(Date.now() - 3600001).toISOString(); }],
    ['future observation', s => { s.source_fetched_at = s.result.fetchedAt = new Date(Date.now() + 60000).toISOString(); }],
    ['noncurrent budget metrics', s => { s.query.resource = 'adsets'; }],
    ['malformed query hash', s => { s.query_hash = 'invalid'; }],
    ['unsupported platform', s => { s.platform = 'shopify'; }],
    ['missing metrics', s => { delete s.result.metrics; }],
  ]) {
    f = await fixture(); change(f.snapshot);
    await assert.rejects(commit(a, f.snapshot, f.holder));
    assert.equal(await count(), 0);
    assert.equal((await admin.query('select holder from backend_leases')).rows[0].holder, f.holder);
    checks.push(name + ' rejected; original lease retained');
  }

  f = await fixture();
  const pair = await Promise.all([commit(a, f.snapshot, f.holder), commit(b, { ...f.snapshot, id: randomUUID() }, f.holder)]);
  assert.equal(pair.filter(Boolean).length, 1);
  assert.equal(await count(), 1);
  checks.push('two concurrent completions yield exactly one accepted snapshot');

  async function waiting(c) {
    for (let i = 0; i < 100; i++) {
      const r = await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [c.processID]);
      if (r.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('Expected independently observed PostgreSQL lock wait');
  }
  for (const relation of ['accounts', 'connectors', 'backend_leases']) {
    f = await fixture();
    await admin.query("update backend_leases set expires_at=clock_timestamp()+interval '400 milliseconds'");
    await admin.query('begin');
    await admin.query(`select 1 from ${relation} for update`);
    const pending = commit(a, f.snapshot, f.holder);
    await waiting(a);
    await admin.query('select pg_sleep(0.45)');
    await admin.query('commit');
    assert.equal(await pending, null);
    assert.equal(await count(), 0);
    checks.push('expiry after observed ' + relation + ' lock wait refuses late completion');
  }

  f = await fixture();
  const successor = randomUUID();
  await admin.query('begin');
  await admin.query('update backend_leases set holder=$1 where lease_key=$2', [successor, key]);
  const pending = commit(a, f.snapshot, f.holder);
  await waiting(a);
  await admin.query('commit');
  assert.equal(await pending, null);
  assert.equal((await admin.query('select holder from backend_leases')).rows[0].holder, successor);
  assert.equal(await count(), 0);
  assert(await commit(b, f.snapshot, successor));
  checks.push('waiter cannot accept or delete successor lease; successor still completes');

  console.log(JSON.stringify({ status: 'PASS', checks, total: checks.length, fixture: 'isolated synthetic PostgreSQL',
    directory, remoteDatabaseCalls: 0, providerCalls: 0, n8nCalls: 0 }, null, 2));
} finally {
  for (const c of clients) { await c.query('rollback').catch(() => {}); await c.end().catch(() => {}); }
  await cluster.stop().catch(() => {});
}
