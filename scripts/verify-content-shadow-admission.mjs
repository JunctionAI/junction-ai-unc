/** Real isolated PostgreSQL tests for Content admission SQL. No .env, remote DB,
 * n8n Cloud, DataForSEO or live AVGAR writes. Historical execution #68 is not used. */
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
const directory = await mkdtemp(join(tmpdir(), 'unc-content-admission-pg-'));
const cluster = new EmbeddedPostgres({
  databaseDir: join(directory, 'db'), user: 'postgres', password: randomUUID(),
  authMethod: 'scram-sha-256', port: 55445, persistent: true, createPostgresUser: false,
  initdbFlags: ['--locale=C'], postgresFlags: ['-h', '127.0.0.1', '-k', directory], onLog: () => {}, onError: () => {},
});
const A = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
const owner = '74802c60-149a-4405-b719-dc058d174072';
const foreign = randomUUID();
const hooksUrl = 'https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow';
const questionsUrl = 'https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow';
const clients = [], checks = [];
const locations = { US: 2840, NZ: 2554, AU: 2036 };
function spec(routine, market = 'US') {
  const key = routine === 'D01-W02' ? 'viral_hooks' : 'customer_questions';
  const contract = {
    contract: 'unc.content-search-shadow.v1', accountId: A, workflowId: 'synthetic-content',
    workflowVersion: '00000000-0000-4000-8000-000000000002', routineId: routine, routineKey: key,
    client: { id: 'avgar', primaryDomain: 'avgarsport.com', seedKeyword: 'golf travel bag',
      locationCode: locations[market], languageCode: 'en' },
  };
  return { id: routine, version: 2, mutates: false, nodes: [
    { kind: 'trigger', id: 'trigger', cadence: 'manual' },
    { kind: 'n8n', id: 'produce', timeoutMs: 60000, shadowContract: contract },
    { kind: 'gate', id: 'gate', title: 'Review', expiryHours: 72 },
    { kind: 'receipt', id: 'receipt', summary: 'drafted' },
  ] };
}
function fixture(routine = 'D01-W02', market = 'US', ttl = 60000) {
  const startedAt = new Date().toISOString(), id = randomUUID(), s = spec(routine, market);
  const ctx = { account: { accountId: A, contextGeneration: 1, currency: 'NZD', budgetMonthly: 0 },
    runId: id, routineId: routine, version: 2, startedAt, mode: 'dry_run',
    caps: { currency: 'NZD', perDay: 0, perMonth: 0 }, triggeredBy: 'manual', vars: {}, inputs: {}, reads: {}, checks: {} };
  return {
    run: { id, accountId: A, contextGeneration: 1, routineId: routine, version: 2, mode: 'dry_run', status: 'running',
      startedAt, specHash: 'spec-hash-' + routine, snapshot: { spec: s, ctx, nextNodeIndex: 0, awaiting: 'content_start', startProtocol: 'content_claim_v1' } },
    approval: { authorizedBy: owner, approvalReference: 'isolated-test', idempotencyKey: randomUUID(),
      contextGeneration: 1, maxProviderCalls: 1, market, routineId: routine, expiresAt: new Date(Date.now() + ttl).toISOString() },
  };
}
let admin, client, peer;
async function bindSpec(f) {
  await admin.query('update routine_states set live_spec=$2, draft_spec=$2, version=2 where account_id=$1 and routine_id=$3',
    [A, f.run.snapshot.spec, f.run.routineId]);
}
const issue = async (f, c = client) => {
  await bindSpec(f);
  return c.query('select issue_content_shadow_run($1) r', [{ run: f.run, approval: f.approval }]).then((r) => r.rows[0].r);
};
const transition = (f, operation, extra = {}, c = client) => c.query('select transition_content_shadow($1) r',
  [{ accountId: f.run.accountId, contextGeneration: 1, runId: f.run.id, operation, ...extra }]).then((r) => r.rows[0].r);
const row = (f) => admin.query('select * from n8n_content_runs where run_id=$1', [f.run.id]).then((r) => r.rows[0]);
async function waiting(f) {
  const snapshot = { ...structuredClone(f.run.snapshot), awaiting: 'content_shadow', nextNodeIndex: 2 };
  await client.query('update routine_runs set snapshot=$1 where id=$2', [snapshot, f.run.id]);
  return snapshot;
}
async function identity(f) {
  const registrationId = (await row(f)).registration_id;
  return { contract: f.run.snapshot.spec.nodes[1].shadowContract, registrationId,
    receiverUrl: f.run.routineId === 'D01-W02' ? hooksUrl : questionsUrl,
    requestDigest: 'b'.repeat(64), tokenDigest: 'c'.repeat(64), specHash: f.run.specHash };
}
async function consume(f) {
  if ((await row(f)).state === 'reserved') assert.equal(await transition(f, 'start', { run: f.run }), true);
  if ((await row(f)).state === 'started') {
    await waiting(f);
    const id = await identity(f);
    assert.ok(await transition(f, 'dispatch', id));
  }
  if (['dispatching', 'authorized', 'verifying'].includes((await row(f)).state)) {
    assert.equal(await transition(f, 'finish', { outcome: 'uncertain', executionId: '12345' }), true);
  }
}
async function refusal(fn, pattern) { await assert.rejects(fn, pattern); }

try {
  await cluster.initialise(); await cluster.start(); await cluster.createDatabase('content_admission');
  for (let i = 0; i < 3; i++) {
    const c = cluster.getPgClient('content_admission', '127.0.0.1'); await c.connect();
    await c.query("set statement_timeout='8s'"); clients.push(c);
  }
  [admin, client, peer] = clients;
  await admin.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table accounts(id uuid primary key, context_generation bigint, automation_paused boolean, currency text);
    create table account_members(account_id uuid, user_id uuid, role text, primary key(account_id, user_id));
    create table n8n_workflows(id uuid primary key, account_id uuid, routine_id text, webhook_url text, active boolean);
    create table routine_states(account_id uuid, routine_id text, enabled boolean, version integer, draft_spec jsonb, live_spec jsonb, primary key(account_id, routine_id));
    create table routine_runs(id uuid primary key, account_id uuid, context_generation bigint, routine_id text, version integer, mode text, status text, started_at timestamptz, finished_at timestamptz, summary text, spec_hash text, snapshot jsonb);
    grant usage on schema public, auth to service_role; grant all on all tables in schema public, auth to service_role;`);
  await admin.query(await readFile(new URL('../supabase/migrations/20260906030000_content_shadow_admission.sql', import.meta.url), 'utf8'));
  checks.push('content admission migration compiles on real PostgreSQL');
  await admin.query('insert into auth.users values ($1),($2)', [owner, foreign]);
  await admin.query('insert into accounts values ($1,1,false,\'NZD\'),($2,1,false,\'NZD\')', [A, foreign]);
  await admin.query("insert into account_members values ($1,$2,'owner')", [A, owner]);
  const hooksReg = randomUUID(), questionsReg = randomUUID(), foreignReg = randomUUID();
  await admin.query('insert into n8n_workflows values ($1,$2,\'D01-W02\',$3,true),($4,$2,\'D01-W03\',$5,true),($6,$7,\'D01-W02\',$3,true)',
    [hooksReg, A, hooksUrl, questionsReg, questionsUrl, foreignReg, foreign]);
  await client.query('set role service_role'); await peer.query('set role service_role');

  for (const role of ['anon', 'authenticated']) {
    await peer.query(`set role ${role}`);
    await refusal(() => issue(fixture(), peer), { code: '42501' });
    await refusal(() => peer.query('select * from n8n_content_runs'), { code: '42501' });
  }
  await peer.query('set role service_role');
  checks.push('browser roles cannot issue allowances or read the content ledger');

  for (const routine of ['D01-W02', 'D01-W03']) {
    await admin.query('insert into routine_states values ($1,$2,true,2,$3,$3) on conflict (account_id,routine_id) do update set enabled=true, version=2, live_spec=excluded.live_spec, draft_spec=excluded.draft_spec',
      [A, routine, spec(routine)]);
  }

  const hooks = fixture('D01-W02', 'US');
  const questions = fixture('D01-W03', 'NZ');
  const issuedHooks = await issue(hooks);
  const issuedQuestions = await issue(questions);
  assert.equal(issuedHooks.created, true); assert.equal(issuedQuestions.created, true);
  assert.notEqual(issuedHooks.permitId, issuedQuestions.permitId);
  assert.equal((await row(hooks)).routine_id, 'D01-W02');
  assert.equal((await row(questions)).routine_id, 'D01-W03');
  checks.push('hooks and questions issue independently on the same AVGAR generation');

  const dup = await Promise.all([issue(hooks), issue(hooks, peer)]);
  assert.equal(dup.filter((r) => r.created).length, 0);
  assert.equal(dup[0].runId, hooks.run.id);
  checks.push('duplicate issuance returns the original run rather than a second permit');

  const starts = await Promise.all([transition(hooks, 'start', { run: hooks.run }), transition(hooks, 'start', { run: hooks.run }, peer)]);
  assert.equal(starts.filter(Boolean).length, 1);
  assert.equal(await transition(questions, 'start', { run: questions.run }), true);
  checks.push('concurrent start has one winner per routine');

  await waiting(hooks); await waiting(questions);
  const hooksId = await identity(hooks);
  const questionsId = await identity(questions);
  const dispatches = await Promise.all([transition(hooks, 'dispatch', hooksId), transition(hooks, 'dispatch', hooksId, peer)]);
  assert.equal(dispatches.filter(Boolean).length, 1);
  assert.equal(await transition(questions, 'dispatch', questionsId), (await row(questions)).id);
  assert.equal(await transition(hooks, 'authorize', { ...hooksId, tokenDigest: 'f'.repeat(64) }), false);
  const allowances = await Promise.all([transition(hooks, 'authorize', hooksId), transition(hooks, 'authorize', hooksId, peer)]);
  assert.equal(allowances.filter(Boolean).length, 1);
  assert.equal(await transition(questions, 'authorize', questionsId), true);
  checks.push('one dispatch and one exact token consumption per routine');

  await transition(hooks, 'finish', { outcome: 'uncertain', executionId: '12345' });
  assert.equal(await transition(hooks, 'dispatch', hooksId), null);
  assert.equal(await transition(hooks, 'authorize', hooksId), false);
  await consume(questions);
  await refusal(() => client.query("update n8n_content_runs set state='reserved' where run_id=$1", [hooks.run.id]), { code: '23514' });
  await refusal(() => client.query('delete from n8n_content_runs where run_id=$1', [hooks.run.id]), { code: '42501' });
  checks.push('uncertain allowance remains consumed; rewind and delete are refused');

  const paused = fixture('D01-W02', 'AU');
  await admin.query('update accounts set automation_paused=true where id=$1', [A]);
  await refusal(() => issue(paused), { code: '40001' });
  await admin.query('update accounts set automation_paused=false where id=$1', [A]);
  checks.push('paused account cannot issue');

  const disabled = fixture('D01-W02', 'AU');
  await bindSpec(disabled);
  await admin.query("update routine_states set enabled=false where account_id=$1 and routine_id='D01-W02'", [A]);
  await refusal(() => client.query('select issue_content_shadow_run($1) r', [{ run: disabled.run, approval: disabled.approval }]), { code: '40001' });
  await admin.query("update routine_states set enabled=true where account_id=$1 and routine_id='D01-W02'", [A]);
  const live = await issue(disabled);
  assert.equal(live.created, true);
  await admin.query("update routine_states set enabled=false where account_id=$1 and routine_id='D01-W02'", [A]);
  await refusal(() => transition(disabled, 'start', { run: disabled.run }), { code: '40001' });
  await admin.query("update routine_states set enabled=true where account_id=$1 and routine_id='D01-W02'", [A]);
  await consume(disabled);
  checks.push('disabled routine cannot issue or start');

  const revoked = fixture('D01-W03', 'AU');
  await admin.query("update n8n_workflows set active=false where routine_id='D01-W03' and account_id=$1", [A]);
  await refusal(() => issue(revoked), { code: '23514' });
  await admin.query("update n8n_workflows set active=true where routine_id='D01-W03' and account_id=$1", [A]);
  const q2 = await issue(revoked);
  assert.equal(q2.created, true);
  await transition(revoked, 'start', { run: revoked.run });
  await waiting(revoked);
  await admin.query("update n8n_workflows set active=false where id=$1", [questionsReg]);
  await refusal(() => transition(revoked, 'dispatch', { ...identity(revoked), registrationId: questionsReg }), { code: '40001' });
  await admin.query("update n8n_workflows set active=true where id=$1", [questionsReg]);
  await consume(revoked);
  checks.push('revoked registration cannot issue or dispatch');

  const expired = fixture('D01-W02', 'AU', 1);
  await new Promise((r) => setTimeout(r, 20));
  await refusal(() => issue(expired), { code: '40001' });
  const expiring = fixture('D01-W02', 'AU', 150);
  const expIssued = await issue(expiring);
  assert.equal(expIssued.created, true);
  await new Promise((r) => setTimeout(r, 200));
  await refusal(() => transition(expiring, 'start', { run: expiring.run }), { code: '40001' });
  checks.push('expired approval cannot issue; in-flight start after expiry is refused');

  const tenant = fixture('D01-W02', 'US');
  tenant.run.accountId = foreign;
  tenant.run.snapshot.ctx.account.accountId = foreign;
  tenant.run.snapshot.spec.nodes[1].shadowContract.accountId = foreign;
  await refusal(() => issue(tenant), { code: '23514' });
  await refusal(() => transition({ ...hooks, run: { ...hooks.run, accountId: foreign } }, 'finish', { outcome: 'uncertain', executionId: '12345' }), { code: 'P0002' });
  checks.push('foreign tenant cannot issue AVGAR content or transition an AVGAR run');

  for (const change of [
    (x) => { x.approval.maxProviderCalls = 2; },
    (x) => { x.approval.extra = 'secret'; },
    (x) => { x.run.snapshot.spec.nodes[1].shadowContract.client.seedKeyword = 'travel bag'; },
    (x) => { x.run.snapshot.spec.nodes[1].shadowContract.routineId = 'D03-W01'; x.run.routineId = 'D03-W01'; x.approval.routineId = 'D03-W01'; },
  ]) {
    const bad = fixture(); change(bad);
    await refusal(() => issue(bad));
    assert.equal((await admin.query('select count(*)::int n from routine_runs where id=$1', [bad.run.id])).rows[0].n, 0);
  }
  checks.push('invalid issuance fails atomically without orphan runs; historical travel-bag seed is refused');

  const skip = fixture('D01-W03', 'US');
  await issue(skip);
  const skipId = await identity(skip);
  await refusal(() => transition(skip, 'dispatch', skipId), { code: '23514' });
  await refusal(() => client.query("update n8n_content_runs set state='dispatching' where run_id=$1", [skip.run.id]), { code: '23514' });
  checks.push('invalid state transitions (dispatch before start, rewind) are refused');

  const grants = (await admin.query(`select proname,
      has_function_privilege('anon', oid, 'execute') anon,
      has_function_privilege('authenticated', oid, 'execute') member,
      has_function_privilege('service_role', oid, 'execute') server
    from pg_proc where proname in ('issue_content_shadow_run','transition_content_shadow') order by proname`)).rows;
  assert.equal(grants.length, 2);
  for (const g of grants) assert.deepEqual({ anon: g.anon, member: g.member, server: g.server }, { anon: false, member: false, server: true });
  assert.equal((await admin.query("select has_table_privilege('authenticated','n8n_content_runs','SELECT') s")).rows[0].s, false);
  checks.push('service_role only; anon/authenticated cannot execute RPCs or read the ledger');

  console.log(JSON.stringify({ status: 'PASS', postgres: (await admin.query('select version() version')).rows[0].version, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message, code: error.code, checks }, null, 2));
  process.exitCode = 1;
} finally {
  for (const c of clients) try { await c.end(); } catch {}
  try { await cluster.stop(); } catch {}
}
