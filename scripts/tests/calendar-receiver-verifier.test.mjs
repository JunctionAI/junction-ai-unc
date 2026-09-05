import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildCalendarReceiverWorkflow } from '../lib/calendar-receiver-workflow.mjs';
import { CALENDAR_DRAFT_ID, CALENDAR_RECEIVER_CREDENTIAL, canonical,
  normalizedParameters, definitionExpectations, inspectDefinition, inspectExecution } from '../verify-calendar-receiver-workflow.mjs';

const expected = definitionExpectations();
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const draft = () => ({ ...buildCalendarReceiverWorkflow(CALENDAR_RECEIVER_CREDENTIAL),
  id: CALENDAR_DRAFT_ID, versionId: '52b301af-a66a-4377-9e36-fe836879e833', activeVersionId: null });
const inspect = w => inspectDefinition(w, expected, hash, normalizedParameters);
const find = (w, name) => w.nodes.find(n => n.name === name);

test('exact generated draft passes without claiming unattended or provider readiness', () => {
  const result = inspect(draft());
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.failures, []);
  assert.equal(result.unattendedReady, false);
});

test('only observed omitted Cloud defaults are normalized without mutating input', () => {
  const w = draft();
  for (const n of w.nodes) {
    if (n.type.endsWith('.set')) { delete n.parameters.mode; delete n.parameters.includeOtherFields; }
    if (n.type.endsWith('.if')) n.parameters.conditions.options.version = 1;
    if (n.type.endsWith('.code')) { delete n.parameters.mode; delete n.parameters.language; }
    if (n.type.endsWith('.httpRequest')) {
      if (n.parameters.method === 'GET') delete n.parameters.method;
      if (n.parameters.authentication === 'none') delete n.parameters.authentication;
      if (n.parameters.options.response.response.neverError === false) delete n.parameters.options.response.response.neverError;
    }
  }
  const before = structuredClone(w);
  assert.equal(inspect(w).status, 'PASS');
  assert.deepEqual(w, before);
});

for (const [label, mutate] of [
  ['wrong workflow', w => { w.id = 'wrong'; }],
  ['missing revision', w => { delete w.versionId; }],
  ['published', w => { w.active = true; }],
  ['active revision', w => { w.activeVersionId = w.versionId; }],
  ['archived', w => { w.isArchived = true; }],
  ['pinned data', w => { w.pinData = { 'Incoming calendar': [{ json: {} }] }; }],
  ['missing node', w => { w.nodes.pop(); }],
  ['duplicate node IDs', w => { w.nodes[1].id = w.nodes[0].id; }],
  ['extra branch', w => { w.connections['Incoming calendar'].main[0].push({ node: 'Read sent campaign pages', type: 'main', index: 0 }); }],
  ['unbounded timeout', w => { w.settings.executionTimeout = -1; }],
  ['manual evidence disabled', w => { w.settings.saveManualExecutions = false; }],
  ['wrong receiver credential', w => { w.nodes[0].credentials.httpHeaderAuth.id = 'Y9Xu3zApLSrcWu1e'; }],
  ['wrong provider credential', w => { find(w, 'Read sent campaign pages').credentials.httpHeaderAuth.id = 'other-client'; }],
  ['wrong authority URL', w => { find(w, 'Authorize calendar').parameters.url = 'https://other.example'; }],
  ['authority retry', w => { find(w, 'Authorize calendar').retryOnFail = true; }],
  ['redirects enabled', w => { find(w, 'Read sent campaign pages').parameters.options.redirect.redirect.followRedirects = true; }],
  ['error output disabled', w => { find(w, 'Build calendar result').onError = 'stopWorkflow'; }],
  ['continue on failure', w => { find(w, 'Build calendar result').continueOnFail = true; }],
  ['disabled validator', w => { find(w, 'Validate calendar request').disabled = true; }],
  ['keep input fields', w => { find(w, 'Validate calendar request').parameters.includeOtherFields = true; }],
  ['changed Code mode', w => { find(w, 'Build calendar result').parameters.mode = 'runOnceForEachItem'; }],
  ['changed compiled code', w => { find(w, 'Build calendar result').parameters.jsCode += '\nreturn [];'; }],
]) test(`definition rejects ${label}`, () => {
  const w = draft(); mutate(w);
  assert.equal(inspect(w).status, 'FAIL');
});

test('execution projection keeps useful denial evidence and excludes secrets/provider payloads', () => {
  const secret = 'DO_NOT_PRINT_THIS_SECRET';
  const e = { id: '96', workflowId: CALENDAR_DRAFT_ID, workflowVersionId: draft().versionId,
    status: 'success', finished: true, startedAt: '2026-09-05T21:12:08.443Z', stoppedAt: '2026-09-05T21:12:08.986Z',
    data: { resultData: { runData: {
      'Incoming calendar': [{ executionStatus: 'success', executionTime: 0, data: { main: [[{ json: {
        headers: { authorization: 'Bearer ' + secret }, body: { dataToken: secret, customer: secret },
      } }]] } }],
      'Authorize calendar': [{ executionStatus: 'success', executionTime: 467,
        data: { main: [[{ json: { statusCode: 401, body: { diagnostics: secret } } }], []] } }],
    } } } };
  const result = inspectExecution(e);
  assert.equal(result.executionId, '96');
  assert.equal(result.actualWorkflowVersion, e.workflowVersionId);
  assert.equal(result.providerNodeExecuted, false);
  assert.equal(result.nodes[1].entries[0].outputs[0][0].statusCode, 401);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('untrusted errors, node names and scalar-shaped payloads cannot bypass projection', () => {
  const secret = 'Bearer DO_NOT_PRINT_THIS_SECRET';
  const result = inspectExecution({ status: secret, finished: secret, startedAt: secret,
    data: { resultData: { runData: { [secret]: [{ executionStatus: secret, executionTime: secret,
      error: { message: secret }, data: { main: [[{ json: { error: { secret }, statusCode: { secret }, result: { valid: secret } } }]] },
    }] } } } });
  assert.equal(JSON.stringify(result).includes('DO_NOT_PRINT'), false);
  assert.equal(result.finished, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.nodes[0].name, 'unrecognized_node');
  assert.equal(result.nodes[0].entries[0].error, 'redacted_error');
});

test('provider reachability, pinned runs and retries remain visible, not a success claim', () => {
  const result = inspectExecution({ retryOf: '123', data: { pinData: { a: [] }, resultData: {
    runData: { 'Read sent campaign pages': [{ executionStatus: 'error', error: { message: 'calendar_authority_expired' } }] },
  } } });
  assert.equal(result.providerNodeExecuted, true);
  assert.equal(result.pinned, true);
  assert.equal(result.retried, true);
  assert.equal(result.nodes[0].entries[0].error, 'calendar_authority_expired');
});

test('malformed or excessive execution attempts fail instead of dumping raw data', () => {
  for (const runData of [[], { invalid: {} }, { invalid: Array(21).fill({}) }])
    assert.throws(() => inspectExecution({ data: { resultData: { runData } } }), /execution_shape/);
});
