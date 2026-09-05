import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectKlaviyoAccountProbe } from '../verify-klaviyo-account-probe.mjs';

// Synthetic negative-test inputs, never provider or production acceptance proof.
function fixture() {
  const trigger = { id: 'f6d224f5-b66e-4876-be7f-f392e7a7b1eb', name: 'Manual', type: 'n8n-nodes-base.manualTrigger' };
  const http = {
    id: 'f77c8ace-6b4a-495a-8fd8-01a78fd09267', name: 'Read account', type: 'n8n-nodes-base.httpRequest',
    credentials: { httpHeaderAuth: { id: '4mkTKL1q0njNafh9', name: 'Header Auth account' } },
    parameters: {
      method: 'GET', url: 'https://a.klaviyo.com/api/accounts/?fields%5Baccount%5D=contact_information.organization_name,contact_information.website_url,timezone,preferred_currency,test_account',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true,
      headerParameters: { parameters: [{ name: 'revision', value: '2026-07-15' }] },
      options: { timeout: 10000, response: { response: { fullResponse: true, responseFormat: 'json' } } },
    },
  };
  const output = { statusCode: 200,
    headers: { cid: 'SuYidF', 'x-klaviyo-api-revision': '2026-07-15', 'x-klaviyo-req-id': '00000000-0000-0000-0000-000000000001', 'unneeded-header': 'must-not-be-returned' },
    body: { data: [{ id: 'SuYidF', type: 'account', attributes: {
      contact_information: { organization_name: 'Avgar', website_url: 'https://avgarsport.com', unwanted_email: 'private@example.test' },
      timezone: 'US/Eastern', preferred_currency: 'USD', test_account: false,
    } }], links: { next: null } },
  };
  return {
    id: '85', workflowId: 'BHU55GyCpcRVh8eq', workflowVersionId: 'a8a13681-4811-4601-b088-9b7a5875db30',
    mode: 'manual', status: 'success', finished: true, retryOf: null,
    startedAt: '2026-09-05T20:11:58.081Z', stoppedAt: '2026-09-05T20:11:58.477Z',
    workflowData: { nodes: [trigger, http], connections: { Manual: { main: [[{ node: 'Read account', type: 'main', index: 0 }]] } } },
    data: { resultData: { runData: {
      Manual: [{ executionStatus: 'success', executionTime: 2 }],
      'Read account': [{ executionStatus: 'success', executionTime: 340, startTime: 1788639118136,
        source: [{ previousNode: 'Manual', previousNodeOutput: 0, previousNodeRun: 0 }],
        data: { main: [[{ json: output }]] } }],
    } } },
  };
}
const http = s => s.workflowData.nodes[1];
const run = s => s.data.resultData.runData['Read account'][0];
const output = s => run(s).data.main[0][0].json;
test('projects only verified identity; source currency remains USD and no binding/readiness is invented', async () => {
  const proof = await projectKlaviyoAccountProbe(fixture());
  assert.equal(proof.providerCurrency, 'USD');
  assert.equal(proof.providerTimezone, 'US/Eastern');
  assert.equal(proof.canonicalProviderTimezone, 'America/New_York');
  assert.equal(proof.bindingCreated, false); assert.equal(proof.calendarReady, false);
  assert.equal(proof.providerAccountId, 'SuYidF'); assert.equal(proof.credentialRef, '4mkTKL1q0njNafh9');
  assert.match(proof.outputDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(proof).includes('private@example.test'));
  assert.ok(!JSON.stringify(proof).includes('must-not-be-returned'));
});
const invalid = {
  'another execution': s => { s.id = '86'; },
  'another workflow': s => { s.workflowId = 'other'; },
  'changed revision': s => { s.workflowVersionId = 'changed'; },
  'conflicting saved revision': s => { s.workflowData.versionId = 'conflicting'; },
  'production trigger': s => { s.mode = 'webhook'; },
  'replayed execution': s => { s.retryOf = '84'; },
  'unfinished execution': s => { s.finished = false; },
  'redacted evidence': s => { s.data.redactionInfo = { isRedacted: true }; },
  'truncated evidence': s => { s.dataTooLargeToDisplay = true; },
  'root pins': s => { s.pinData = { Manual: [{}] }; },
  'saved pins': s => { s.workflowData.pinData = { Manual: [{}] }; },
  'execution pins': s => { s.data.pinData = { Manual: [{}] }; },
  'extra node': s => { s.workflowData.nodes.push({ type: 'send' }); },
  'wrong credential': s => { http(s).credentials.httpHeaderAuth.id = 'keyword-receiver'; },
  'credential auth not enabled': s => { http(s).parameters.authentication = 'none'; },
  'provider mutation': s => { http(s).parameters.method = 'POST'; },
  'different endpoint': s => { http(s).parameters.url = 'https://elsewhere.test/'; },
  'extra query fields': s => { http(s).parameters.sendQuery = true; },
  'request body': s => { http(s).parameters.sendBody = true; },
  'added headers': s => { http(s).parameters.headerParameters.parameters.push({ name: 'Authorization', value: 'synthetic' }); },
  'retry enabled': s => { http(s).retryOnFail = true; },
  'continue error': s => { http(s).onError = 'continueRegularOutput'; },
  'node disabled': s => { http(s).disabled = true; },
  'unbounded request': s => { delete http(s).parameters.options.timeout; },
  'pagination added': s => { http(s).parameters.options.pagination = {}; },
  'different connection': s => { s.workflowData.connections.Manual.main[0][0].node = 'other'; },
  'duplicate HTTP run': s => { s.data.resultData.runData['Read account'].push(run(s)); },
  'zero execution time': s => { run(s).executionTime = 0; },
  'failed node': s => { run(s).executionStatus = 'error'; },
  'failed response': s => { output(s).statusCode = 403; },
  'wrong provider account': s => { output(s).body.data[0].id = 'other'; },
  'wrong response account header': s => { output(s).headers.cid = 'other'; },
  'another domain': s => { output(s).body.data[0].attributes.contact_information.website_url = 'https://other.test'; },
  'test account': s => { output(s).body.data[0].attributes.test_account = true; },
  'partial account list': s => { output(s).body.links.next = 'next'; },
  'silently converted currency': s => { output(s).body.data[0].attributes.preferred_currency = 'NZD'; },
  'silently substituted timezone': s => { output(s).body.data[0].attributes.timezone = 'Pacific/Auckland'; },
  'node outside saved execution window': s => { run(s).startTime += 10000; },
};
for (const [name, change] of Object.entries(invalid)) test(`rejects ${name}`, async () => {
  const saved = fixture(); change(saved);
  await assert.rejects(projectKlaviyoAccountProbe(saved));
});
