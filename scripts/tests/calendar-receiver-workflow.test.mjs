import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildCalendarReceiverWorkflow, CALENDAR_AUTHORITY_URL, CALENDAR_PROVIDER_CREDENTIAL } from '../lib/calendar-receiver-workflow.mjs';

const credential = { id: 'synthetic-calendar-receiver', name: 'Synthetic receiver' };
const workflow = buildCalendarReceiverWorkflow(credential);
const named = name => workflow.nodes.find(n => n.name === name);
const evaluate = (expression, bindings = {}) => vm.runInNewContext(`(${expression.slice(3, -2)})`, bindings, { timeout: 1000 });

test('draft has one authenticated trigger, separate provider binding and bounded execution', () => {
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.nodes.filter(n => n.type.endsWith('.webhook')).length, 1);
  assert.equal(named('Incoming calendar').parameters.authentication, 'headerAuth');
  assert.deepEqual(named('Incoming calendar').credentials.httpHeaderAuth, credential);
  assert.deepEqual(named('Read sent campaign pages').credentials.httpHeaderAuth, CALENDAR_PROVIDER_CREDENTIAL);
  assert.equal(workflow.settings.executionTimeout, 50);
  assert.equal(workflow.settings.saveManualExecutions, true);
});

test('existing provider and keyword receiver credentials cannot become the calendar receiver', () => {
  for (const id of ['4mkTKL1q0njNafh9', 'Y9Xu3zApLSrcWu1e', 'invalid credential'])
    assert.throws(() => buildCalendarReceiverWorkflow({ id, name: 'wrong' }));
});

test('editing a generated definition cannot mutate credential inputs or future definitions', () => {
  const input = { ...credential };
  const first = buildCalendarReceiverWorkflow(input);
  first.nodes.find(n => n.name === 'Incoming calendar').credentials.httpHeaderAuth.id = 'edited';
  first.nodes.find(n => n.name === 'Read sent campaign pages').credentials.httpHeaderAuth.id = 'edited';
  const second = buildCalendarReceiverWorkflow(input);
  assert.deepEqual(input, credential);
  assert.deepEqual(second.nodes.find(n => n.name === 'Incoming calendar').credentials.httpHeaderAuth, credential);
  assert.equal(second.nodes.find(n => n.name === 'Read sent campaign pages').credentials.httpHeaderAuth.id, '4mkTKL1q0njNafh9');
});

test('all expressions contain only their final n8n closing delimiter', () => {
  const walk = value => {
    if (typeof value === 'string' && value.startsWith('={{')) {
      assert.ok(value.endsWith('}}'));
      assert.ok(!value.slice(3, -2).includes('}}'), 'an embedded delimiter can terminate the expression');
      new vm.Script(`(${value.slice(3, -2)})`);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  workflow.nodes.forEach(n => walk(n.parameters));
});

test('invalid input produces a structured 400 response without evaluating authority or provider nodes', () => {
  const validator = named('Validate calendar request').parameters.assignments.assignments[0].value;
  const result = evaluate(validator, { $workflow: { id: 'synthetic-workflow' }, $now: { toISO: () => '2026-09-06T12:00:00Z' },
    $: name => { assert.equal(name, 'Incoming calendar'); return { first: () => ({ json: { body: {} } }) }; } });
  assert.equal(result.valid, false);
  assert.ok(result.details.accountId);
  const response = named('Return invalid request');
  assert.equal(response.parameters.options.responseCode, 400);
  const body = evaluate(response.parameters.responseBody, { $: name => {
    assert.equal(name, 'Validate calendar request'); return { first: () => ({ json: { result } }) };
  } });
  assert.equal(body.error, 'validation_error');
  assert.equal(body.executedAction, 'none');
});

test('authority uses only the pinned origin, one request and the run-scoped bearer', () => {
  const node = named('Authorize calendar');
  assert.equal(node.parameters.url, CALENDAR_AUTHORITY_URL);
  assert.equal(node.parameters.method, 'POST');
  assert.equal(node.parameters.sendBody, undefined);
  assert.equal(node.retryOnFail, false);
  assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
  assert.equal(node.credentials, undefined);
});

test('provider reads are bounded and cannot follow unvalidated pagination', () => {
  const p = named('Read sent campaign pages').parameters;
  assert.equal(p.method, 'GET');
  assert.equal(p.options.timeout, 5000);
  assert.equal(p.options.pagination.pagination.maxRequests, 5);
  assert.equal(p.options.response.response.neverError, false);
  assert.match(p.options.pagination.pagination.nextURL, /api\.calendarNextPage\(/);
  assert.match(p.url, /calendar_authority_expired/);
  assert.match(p.options.pagination.pagination.nextURL, /calendar_authority_expired/);
});

test('every branch has a terminal HTTP response; no hidden schedule or subworkflow', () => {
  const names = new Set(workflow.nodes.map(n => n.name));
  assert.equal(names.size, workflow.nodes.length);
  assert.equal(workflow.nodes.some(n => /scheduleTrigger|executeWorkflow/.test(n.type)), false);
  for (const n of workflow.nodes) {
    const edges = workflow.connections[n.name]?.main;
    if (n.type.endsWith('.respondToWebhook')) {
      assert.equal(edges, undefined);
      assert.equal(n.parameters.options.enableStreaming, false);
    } else {
      assert.ok(edges?.length);
      if (n.onError === 'continueErrorOutput') assert.equal(edges.length, n.type.endsWith('.if') ? 3 : 2);
      for (const edge of edges.flat()) assert.ok(names.has(edge.node));
    }
  }
  const visit = (name, path = []) => {
    assert.ok(!path.includes(name), 'no cycles/retries in synchronous receiver');
    const edges = workflow.connections[name]?.main.flat();
    if (!edges) return assert.equal(named(name).type, 'n8n-nodes-base.respondToWebhook');
    for (const edge of edges) visit(edge.node, [...path, name]);
  };
  visit('Incoming calendar');
});

test('only success returns an artifact; authority status and error bodies stay explicit', () => {
  for (const status of [401, 403, 404, 409, 429, 500, 200]) {
    const response = named('Return authority refusal');
    const actual = evaluate(response.parameters.options.responseCode, {
      $: () => ({ first: () => ({ json: { statusCode: status } }) }),
    });
    assert.equal(actual, status >= 400 && status < 500 ? status : 502);
  }
  for (const name of ['Return authority refusal', 'Return upstream failure', 'Return internal failure']) {
    const body = evaluate(named(name).parameters.responseBody);
    assert.equal(body.executedAction, 'none');
    assert.equal(body.artifact, undefined);
  }
});
