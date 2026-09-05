import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { buildCalendarReceiverBundle } from '../lib/calendar-receiver-bundle.mjs';
import { buildCalendarReceiverFixture, runCalendarReceiverFixture } from '../lib/calendar-receiver-fixture.mjs';
import { fixtureExpectations, verifyFixtureDefinition, verifyFixtureExecution, canonicalFixture } from '../verify-calendar-receiver-fixture.mjs';

test('deterministic bundle retains reviewed source hashes and exposes only pure functions', () => {
  const bundle = buildCalendarReceiverBundle();
  assert.deepEqual(bundle, buildCalendarReceiverBundle());
  assert.equal(bundle.inputs.length, 2);
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(bundle.expression, /\b(?:require|import|fetch|process|exports)\b/);
  const api = vm.runInNewContext(bundle.expression, {}, { timeout: 1000 });
  assert.equal(Object.keys(api).length, 9);
  assert.equal(runCalendarReceiverFixture(api).checksPassed, 22);
});

test('exact Cloud fixture code executes offline without network, filesystem or credentials', () => {
  const fixture = buildCalendarReceiverFixture();
  const result = vm.runInNewContext(`(() => { ${fixture.code} })()`, {}, { timeout: 1000 });
  assert.equal(result.length, 1);
  assert.equal(result[0].json.synthetic, true);
  assert.equal(result[0].json.checksPassed, 22);
  assert.equal(result[0].json.bundleSha256, fixture.sha256);
  assert.equal(result[0].json.envelope.artifact.items.length, 6);
});

const hash = value => createHash('sha256').update(value).digest('hex');
function executionFixture() {
  const f = buildCalendarReceiverFixture(), expected = fixtureExpectations('98765');
  const trigger = { id: expected.triggerId, name: 'Manual', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} };
  const code = { id: expected.codeId, name: 'Check', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: f.code } };
  const definition = { id: expected.workflowId, versionId: '00000000-0000-4000-8000-000000000005', active: false, pinData: {},
    nodes: [trigger, code], connections: { Manual: { main: [[{ node: 'Check', type: 'main', index: 0 }]] } } };
  const output = vm.runInNewContext(`(() => { ${f.code} })()`, {}, { timeout: 1000 });
  const execution = { id: expected.executionId, workflowId: expected.workflowId, workflowVersionId: definition.versionId,
    workflowData: definition, status: 'success', finished: true, mode: 'manual',
    data: { resultData: { runData: {
      Manual: [{ executionStatus: 'success', data: { main: [[{ json: {} }]] } }],
      Check: [{ executionStatus: 'success', executionTime: 10, data: { main: [JSON.parse(JSON.stringify(output))] } }],
    } } } };
  return { definition, execution, expected };
}
test('independent verifier requires the exact saved fixture code and output', () => {
  const { definition, execution, expected } = executionFixture();
  assert.equal(verifyFixtureDefinition(definition, expected, hash).active, false);
  const proof = verifyFixtureExecution(execution, expected, hash, canonicalFixture);
  assert.equal(proof.status, 'PASS'); assert.equal(proof.checksPassed, 22);
  assert.equal(proof.productionCalendarAccepted, false);
});
test('Cloud saved snapshot may omit revision/active; only the actual top-level execution revision supplies evidence', () => {
  const { definition, execution, expected } = executionFixture();
  delete definition.versionId; delete definition.active;
  definition.nodes[0].parameters.notice = '';
  definition.nodes[1].parameters.mode = 'runOnceForAllItems';
  definition.nodes[1].parameters.language = 'javaScript';
  const proof = verifyFixtureExecution(execution, expected, hash, canonicalFixture);
  assert.equal(proof.savedDefinitionVersion, null);
  assert.equal(proof.actualWorkflowVersion, '00000000-0000-4000-8000-000000000005');
  assert.throws(() => verifyFixtureDefinition(definition, expected, hash));
  delete execution.workflowVersionId;
  assert.throws(() => verifyFixtureExecution(execution, expected, hash, canonicalFixture));
});
for (const fault of ['different-workflow', 'published', 'credential', 'extra-node', 'changed-code', 'wrong-wire', 'pinned', 'retry', 'continue-error',
  'different-execution', 'running', 'wrong-mode', 'retry-execution', 'execution-pin', 'changed-output', 'missing-node', 'node-error', 'duplicate-output']) {
  test(`independent verifier refuses ${fault}`, () => {
    const { definition: w, execution: e, expected } = executionFixture();
    if (fault === 'different-workflow') w.id = 'other';
    if (fault === 'published') w.active = true;
    if (fault === 'credential') w.nodes[1].credentials = { httpHeaderAuth: { id: 'synthetic' } };
    if (fault === 'extra-node') w.nodes.push({ id: 'extra', type: 'n8n-nodes-base.httpRequest' });
    if (fault === 'changed-code') w.nodes[1].parameters.jsCode += '\n// changed';
    if (fault === 'wrong-wire') w.connections.Manual.main[0][0].index = 1;
    if (fault === 'pinned') w.pinData.Manual = [{}];
    if (fault === 'retry') w.nodes[1].retryOnFail = true;
    if (fault === 'continue-error') w.nodes[1].onError = 'continueRegularOutput';
    if (fault === 'different-execution') e.id = 'other';
    if (fault === 'running') e.status = 'running';
    if (fault === 'wrong-mode') e.mode = 'webhook';
    if (fault === 'retry-execution') e.retryOf = 'other';
    if (fault === 'execution-pin') e.data.pinData = { Manual: [{}] };
    if (fault === 'changed-output') e.data.resultData.runData.Check[0].data.main[0][0].json.checksPassed = 99;
    if (fault === 'missing-node') delete e.data.resultData.runData.Manual;
    if (fault === 'node-error') e.data.resultData.runData.Check[0].error = { message: 'synthetic error' };
    if (fault === 'duplicate-output') e.data.resultData.runData.Check[0].data.main[0].push({ json: {} });
    assert.throws(() => verifyFixtureExecution(e, expected, hash, canonicalFixture));
  });
}
