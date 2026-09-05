/** Offline exact-builder review using independently captured historical inputs.
 * No network or workflow execution. VM is not a sandbox for arbitrary code. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateArtifactObject } = require('../dist/worker/lib/artifacts/validate.js');
const base = new URL('../docs/integration/deliveries/nguyen-2026-09-06-final/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const provider = JSON.parse(await readFile(new URL('../docs/integration/deliveries/nguyen-2026-09-06/independent-provider-inputs.json', import.meta.url), 'utf8'));
const deliveredCode = (await readFile(new URL('d03/D03-W01_build_artifact_final_jscode.js.txt', base), 'utf8')).trim();
assert.equal(createHash('sha256').update(deliveredCode).digest('hex'), '399dfef1d77fc2e285d957510ab374e3234acd6ef2893bbb7342f542be07425e');
const code = (await readFile(new URL('d03/independently-observed-published-builder.js.txt', base), 'utf8')).trim();
assert.equal(code, deliveredCode.replace('top_status_code: topStatus, task_status_code: taskStatus, taskId: taskId', 'top_status_code: topStatus, taskStatusCode: taskStatus, taskId: taskId'));
const hash = createHash('sha256').update(code).digest('hex');
assert.equal(hash, '8668beead72a6d83862039f40a07ea76f42dc24244a52b6644870cbfbc0bf497');
const script = new Script('(function(){\n' + code + '\n})()');
function replay(fixture, clock, mutate = () => {}) {
  const f = structuredClone(fixture);
  mutate(f.http.body.tasks[0].result[0].items[0], f);
  const context = createContext({
    $: name => { assert.equal(name, 'Validate Authority'); return { first: () => ({ json: f.auth }) }; },
    $input: { first: () => ({ json: f.http }) },
    $workflow: { id: 'XiXJKuph1fAeH9pe' }, $execution: { id: f.executionId },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } },
  }, { codeGeneration: { strings: false, wasm: false } });
  return JSON.parse(JSON.stringify(script.runInContext(context, { timeout: 1000 })[0].json));
}
const markets = { 2840: 'US', 2554: 'NZ', 2036: 'AU' }, exact = [];
for (const f of provider.fixtures) {
  const market = markets[f.auth.location_code];
  const delivered = await read(`d03/D03-W01_exact_replay_${market}_${f.executionId}.json`);
  const { payload, http_status } = replay(f, delivered.fixedClockFetchedAt);
  assert.equal(http_status, 200);
  assert.deepEqual(payload, { artifact: delivered.artifact, executionReceipt: delivered.executionReceipt });
  const parsed = validateArtifactObject(payload.artifact, { kind: 'keyword_list', maxItems: 15, allowedNumbers: null });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.artifact.evidence.length, 1);
  assert.equal(parsed.artifact.evidence[0].ref, payload.artifact.evidence[0].ref);
  assert.equal(payload.executionReceipt.workflowVersion, null);
  assert.equal(payload.executionReceipt.revisionEvidence, 'pending_unc_verification');
  assert.equal(payload.executionReceipt.executedAction, 'none');
  const item = payload.artifact.items[0].meta;
  assert.equal(item.target_page, null); assert.equal(item.target_page_status, 'unverified');
  assert.equal(item.priority, null); assert.equal(item.prioritization, 'pending');
  exact.push({ market, historicalInputExecution: f.executionId, exactFixtureMatch: true,
    evidenceRetained: true, difficulty: item.provider_stats.keyword_difficulty });
}
const clock = '2026-09-05T15:00:02.897Z', boundaries = [];
const cases = [
  ['zero-serp', i => { i.serp_info = { se_results_count: 0 }; }, 3],
  ['check-url', i => { i.serp_info = { check_url: 'https://www.google.com/search?q=golf+travel+bag' }; }, 3],
  ['unrelated-serp', i => { i.serp_info = { items: [{ url: 'https://example.org/unrelated' }] }; }, 3],
  ...[undefined, null, '', ' ', 'bad', Infinity, -1, 101, true].map((value, index) => [
    `invalid-kd-${index}`, i => { i.keyword_properties.keyword_difficulty = value; }, null]),
];
for (const [name, mutate, expectedKd] of cases) {
  const item = replay(provider.fixtures[0], clock, mutate).payload.artifact.items[0].meta;
  assert.equal(item.target_page, null); assert.equal(item.target_page_status, 'unverified');
  assert.equal(item.prioritization, 'pending'); assert.equal(item.priority, null);
  assert.equal(item.provider_stats.keyword_difficulty, expectedKd);
  boundaries.push({ name, pass: true });
}
const failures = [];
for (const [name, mutate] of [
  ['http-error', (_, f) => { f.http.statusCode = 503; }],
  ['task-error', (_, f) => { f.http.body.tasks[0].status_code = 40000; }],
]) {
  const result = replay(provider.fixtures[0], clock, mutate);
  assert.equal(result.http_status, 502); assert.equal(result.payload.ok, false);
  if(name==='task-error')assert.equal(result.payload.taskStatusCode,40000);
  assert.equal(result.payload.artifact, undefined); failures.push({ name, pass: true });
}
const zero = replay(provider.fixtures[0], clock, (_, f) => {
  f.http.body.tasks[0].result[0].items = []; f.http.body.tasks[0].result[0].items_count = 0;
});
assert.equal(zero.payload.artifact, undefined); assert.equal(zero.payload.needs[0].input, 'keyword_provider_items');
const packaged = [];
for (const [name, kind] of [['D05-W01_welcome.json', 'email'], ['D05-W05_post_purchase.json', 'email'], ['D05-W07_six_week_calendar.json', 'calendar']]) {
  const artifact = await read(name);
  const parsed = validateArtifactObject(artifact, { kind, maxItems: 10, allowedNumbers: null });
  assert.equal(parsed.ok, true); packaged.push({ name, kind, schemaAccepted: true, contentAcceptance: 'separate' });
}
const inventory = await read('five_lane_handoff_inventory.json');
const missing = [];
for (const row of inventory.rows.filter(r => r.proof_class === 'PACKAGED_ARTIFACT_READY')) {
  const refs = row.sample_output.match(/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:json|js)/g) ?? [];
  assert.ok(refs.length > 0);
  for (const file of refs) {
    try { await readFile(new URL(file.endsWith('.js') ? file + '.txt' : file, base)); }
    catch { missing.push({ routine: row.routine, file }); }
  }
}
assert.deepEqual(missing, []);
// Additional, previously unrequested type/provenance probes. Report actual
// behavior without mistaking an explicit boolean for independently verified data.
const residuals = [
  ['array-difficulty', i => { i.keyword_properties.keyword_difficulty = []; }],
  ['unbound-verified-url', i => { i.verified_client_page = { verified: true, url: 'https://example.org/not-avgar' }; }],
].map(([name, mutate]) => {
  const m = replay(provider.fixtures[0], clock, mutate).payload.artifact.items[0].meta;
  return { name, difficulty: m.provider_stats.keyword_difficulty, target: m.target_page, prioritization: m.prioritization };
});
console.log(JSON.stringify({ status: 'REQUESTED_CORRECTIONS_PASS_OFFLINE', builderHash: hash,
  declaredRevision: inventory.current_d03_frozen_revision, publishedIdentityRequiresSeparateRead: true,
  deliveredExportExact: false, acceptedDifference: 'task-error diagnostic field uses taskStatusCode in published code',
  exact, boundaries, failures, zeroResultNeedsInput: true, packaged, inventoryRows: inventory.rows.length,
  packagedFilesPresent: true, residuals, providerCalls: 0, n8nCalls: 0, writes: 0 }, null, 2));
