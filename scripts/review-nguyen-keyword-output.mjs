/** Offline replay of an inspected, hash-pinned output builder. No n8n/provider
 * execution. VM is a convenience, not a security boundary for arbitrary code. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateArtifactObject } = require('../dist/worker/lib/artifacts/validate.js');
const directory = new URL('../docs/integration/deliveries/nguyen-2026-09-06/', import.meta.url);
const read = name => readFile(new URL(name, directory), 'utf8');
const provider = JSON.parse(await read('independent-provider-inputs.json'));
const code = (await read('D03-W01_build_artifact_corrected_jscode.js.txt')).trim();
assert.equal(createHash('sha256').update(code).digest('hex'), 'c20f01dbe355c5ac16cc917526f3c3ae1bbddbbba5ba4e5d5e843d166368b513');
assert.equal(provider.builderHash, createHash('sha256').update(code).digest('hex'));
const script = new Script('(function(){\n' + code + '\n})()');
function replay(fixture, fetchedAt, mutate = () => {}) {
  const f = structuredClone(fixture);
  mutate(f.http.body.tasks[0].result[0].items[0]);
  const context = createContext({
    $: name => { assert.equal(name, 'Validate Authority'); return { first: () => ({ json: f.auth }) }; },
    $input: { first: () => ({ json: f.http }) },
    $workflow: { id: 'XiXJKuph1fAeH9pe' }, $execution: { id: f.executionId },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [fetchedAt])); } },
  }, { codeGeneration: { strings: false, wasm: false } });
  return script.runInContext(context, { timeout: 1000 })[0].json.payload;
}
const markets = { 2840: 'US', 2554: 'NZ', 2036: 'AU' };
const historical = [];
for (const f of provider.fixtures) {
  const market = markets[f.auth.location_code];
  const delivered = JSON.parse(await read(`D03-W01_fixture_${market}_${f.executionId}.json`));
  const actual = JSON.parse(JSON.stringify(replay(f, delivered.executionReceipt.finishedAt)));
  assert.equal(actual.artifact.items.length, 1);
  assert.deepEqual(actual.artifact.items[0].meta.provider_stats, delivered.artifact.items[0].meta.provider_stats);
  assert.equal(actual.artifact.items[0].meta.target_page_status, 'unverified');
  assert.equal(actual.artifact.items[0].meta.prioritization, 'pending');
  assert.equal(actual.artifact.items[0].meta.priority, null);
  const parsed = validateArtifactObject(actual.artifact, { kind: 'keyword_list', maxItems: 15, allowedNumbers: null });
  assert.equal(parsed.ok, true);
  const diffs = [];
  function compare(a, b, path = '') {
    if (isDeepStrictEqual(a, b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[k], b[k], path ? path + '.' + k : k);
    } else diffs.push(path);
  }
  compare(actual, { artifact: delivered.artifact, executionReceipt: delivered.executionReceipt });
  historical.push({ market, executionId: f.executionId, statsMatch: true, prioritization: 'pending',
    keywordDifficulty: actual.artifact.items[0].meta.provider_stats.keyword_difficulty,
    exactFixtureDifferences: diffs, providerEvidenceBeforeValidation: actual.artifact.evidence.length,
    providerEvidenceAfterValidation: parsed.artifact.evidence.length });
}
const boundaryCases = [];
for (const [name, mutate] of [
  ['zero result count is not a matched page', i => { i.serp_info = { se_results_count: 0 }; }],
  ['search check URL is not a matched page', i => { i.serp_info = { check_url: 'https://www.google.com/search?q=golf+travel+bag' }; }],
  ['unrelated SERP item is not an AVGAR page', i => { i.serp_info = { items: [{ url: 'https://example.org/unrelated' }] }; }],
  ['blank difficulty must not become zero', i => { i.serp_info = { se_results_count: 0 }; i.keyword_properties.keyword_difficulty = ''; }],
  ['malformed difficulty must not become a scored result', i => { i.serp_info = { se_results_count: 0 }; i.keyword_properties.keyword_difficulty = 'bad'; }],
]) {
  const out = replay(provider.fixtures[0], '2026-09-05T15:00:02.897Z', mutate).artifact.items[0].meta;
  assert.equal(out.target_page, null);
  assert.equal(out.target_page_status, 'matched');
  assert.equal(out.prioritization, 'scored');
  boundaryCases.push({ case: name, targetPage: out.target_page, targetStatus: out.target_page_status,
    prioritization: out.prioritization, priority: out.priority, difficulty: out.provider_stats.keyword_difficulty,
    difficultyFinite: Number.isFinite(out.provider_stats.keyword_difficulty), acceptance: 'FAIL' });
}
const packagedKinds = [];
for (const [name, kind] of [['D05-W01_welcome_draft.json', 'email'], ['D05-W05_post_purchase_draft.json', 'email'], ['D05-W07_six_week_calendar.json', 'calendar']]) {
  const draft = JSON.parse(await read(name));
  const parsed = validateArtifactObject(draft, { kind, maxItems: 10, allowedNumbers: null });
  packagedKinds.push({ file: name, declaredKind: draft.kind, expectedKind: kind, accepted: parsed.ok, reason: parsed.reason });
}
console.log(JSON.stringify({ review: 'REPRODUCED_OUTPUT_GAPS', revision: provider.revision, historical,
  boundaryCases, packagedKinds, providerCalls: 0, n8nCalls: 0, writes: 0 }, null, 2));
