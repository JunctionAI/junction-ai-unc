/** GET-only verification of the separately owned manual account probe.
 * Raw executions and credentials stay on the worker; this does not admit a run,
 * register a binding, or make another Klaviyo call. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function projectKlaviyoAccountProbe(saved) {
  const { default: assert } = await import('node:assert/strict');
  const { createHash } = await import('node:crypto');
  const workflowId = 'BHU55GyCpcRVh8eq';
  const revision = 'a8a13681-4811-4601-b088-9b7a5875db30';
  const credentialId = '4mkTKL1q0njNafh9';
  const url = 'https://a.klaviyo.com/api/accounts/?fields%5Baccount%5D=contact_information.organization_name,contact_information.website_url,timezone,preferred_currency,test_account';
  assert.equal(saved.id, '85');
  assert.equal(saved.workflowId, workflowId);
  assert.equal(saved.workflowVersionId ?? saved.workflowData?.versionId, revision);
  if (saved.workflowData?.versionId != null) assert.equal(saved.workflowData.versionId, revision);
  assert.equal(saved.mode, 'manual');
  assert.equal(saved.status, 'success');
  assert.equal(saved.finished, true);
  assert.ok(saved.retryOf == null && saved.dataTooLargeToDisplay !== true);
  const snapshot = saved.workflowData, data = saved.data;
  assert.ok(snapshot && data && data.redactionInfo?.isRedacted !== true);
  if (snapshot.id != null) assert.equal(snapshot.id, workflowId);
  for (const pins of [saved.pinData, snapshot.pinData, data.pinData]) assert.equal(Object.keys(pins ?? {}).length, 0);
  assert.equal(snapshot.nodes.length, 2);
  const trigger = snapshot.nodes.find(n => n.id === 'f6d224f5-b66e-4876-be7f-f392e7a7b1eb');
  const http = snapshot.nodes.find(n => n.id === 'f77c8ace-6b4a-495a-8fd8-01a78fd09267');
  assert.ok(trigger && http);
  assert.equal(trigger.type, 'n8n-nodes-base.manualTrigger');
  assert.equal(http.type, 'n8n-nodes-base.httpRequest');
  assert.notEqual(trigger.name, http.name);
  for (const n of [trigger, http]) {
    assert.ok(n.disabled !== true && n.retryOnFail !== true && n.continueOnFail !== true);
    assert.ok(n.onError == null || n.onError === 'stopWorkflow');
  }
  const p = http.parameters;
  assert.equal(p.method ?? 'GET', 'GET'); assert.equal(p.url, url);
  assert.equal(p.authentication, 'genericCredentialType'); assert.equal(p.genericAuthType, 'httpHeaderAuth');
  assert.deepEqual(Object.keys(http.credentials), ['httpHeaderAuth']);
  assert.equal(http.credentials.httpHeaderAuth.id, credentialId);
  assert.ok(!p.sendBody && !p.sendQuery && !p.provideSslCertificates);
  assert.equal(p.sendHeaders, true); assert.equal(p.specifyHeaders ?? 'keypair', 'keypair');
  assert.deepEqual(p.headerParameters, { parameters: [{ name: 'revision', value: '2026-07-15' }] });
  assert.deepEqual(Object.keys(p.options).sort(), ['response', 'timeout']);
  assert.equal(p.options.timeout, 10000);
  assert.equal(p.options.response.response.fullResponse, true);
  assert.equal(p.options.response.response.responseFormat, 'json');
  assert.ok(!p.options.response.response.neverError);
  assert.deepEqual(snapshot.connections, { [trigger.name]: { main: [[{ node: http.name, type: 'main', index: 0 }]] } });
  assert.ok(data.resultData && data.resultData.error == null);
  const runs = data.resultData.runData;
  assert.deepEqual(Object.keys(runs).sort(), [trigger.name, http.name].sort());
  for (const name of [trigger.name, http.name]) {
    assert.equal(runs[name].length, 1);
    assert.equal(runs[name][0].executionStatus, 'success');
    assert.ok(runs[name][0].error == null && runs[name][0].executionTime > 0);
  }
  const task = runs[http.name][0];
  assert.deepEqual(task.source, [{ previousNode: trigger.name, previousNodeOutput: 0, previousNodeRun: 0 }]);
  assert.equal(task.data.main.length, 1); assert.equal(task.data.main[0].length, 1);
  const output = task.data.main[0][0].json;
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers['x-klaviyo-api-revision'], '2026-07-15');
  assert.equal(output.headers.cid, 'SuYidF');
  assert.match(output.headers['x-klaviyo-req-id'], /^[a-f0-9-]{36}$/);
  assert.equal(output.body.data.length, 1);
  assert.equal(output.body.links.next, null);
  const account = output.body.data[0], a = account.attributes;
  assert.equal(account.id, 'SuYidF'); assert.equal(account.type, 'account');
  assert.equal(a.contact_information.website_url, 'https://avgarsport.com');
  assert.equal(a.contact_information.organization_name, 'Avgar');
  assert.equal(a.test_account, false);
  assert.equal(a.timezone, 'US/Eastern'); assert.equal(a.preferred_currency, 'USD');
  const start = Date.parse(saved.startedAt), stop = Date.parse(saved.stoppedAt);
  assert.ok(Number.isFinite(start) && stop >= start && stop - start <= 10000);
  assert.ok(task.startTime >= start && task.startTime + task.executionTime <= stop);
  return {
    evidence: 'independently_read_saved_manual_execution', workflowId, workflowVersion: revision,
    executionId: saved.id, credentialRef: credentialId, startedAt: saved.startedAt, stoppedAt: saved.stoppedAt,
    provider: 'klaviyo', providerAccountId: account.id, primaryDomain: 'avgarsport.com',
    organizationName: a.contact_information.organization_name, providerTimezone: a.timezone,
    canonicalProviderTimezone: new Intl.DateTimeFormat('en', { timeZone: a.timezone }).resolvedOptions().timeZone,
    providerCurrency: a.preferred_currency, testAccount: false, statusCode: 200,
    providerRequestId: output.headers['x-klaviyo-req-id'], providerRevision: output.headers['x-klaviyo-api-revision'],
    outputDigest: createHash('sha256').update(JSON.stringify(output)).digest('hex'),
    httpNodeExecutionMs: task.executionTime, pinnedNodes: 0,
    calendarReady: false, bindingCreated: false,
  };
}

async function main() {
  if (process.argv.length !== 2) throw Error('This verifier accepts no overrides');
  const source = `
    const finish = value => process.stdout.write(JSON.stringify(value)+'\\n',()=>process.exit(value.status==='PASS'?0:1));
    const timer = setTimeout(()=>finish({status:'FAIL',stage:'timeout'}),30000);
    (async()=>{
      const assert=require('node:assert/strict');
      const base='https://junctionai8.app.n8n.cloud/api/v1';
      assert.equal(process.env.N8N_EXECUTION_API_BASE_URL,base);
      const response=await fetch(base+'/executions/85?includeData=true',{method:'GET',redirect:'error',cache:'no-store',
        headers:{accept:'application/json','X-N8N-API-KEY':process.env.N8N_EXECUTION_API_KEY},signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,200);let bytes=0;const chunks=[];
      for await(const part of response.body){bytes+=part.length;assert.ok(bytes<=1048576);chunks.push(Buffer.from(part));}
      const proof=await (${projectKlaviyoAccountProbe.toString()})(JSON.parse(Buffer.concat(chunks).toString()));
      return {status:'PASS',checkedAt:new Date().toISOString(),...proof,n8nReads:1,providerCalls:0,writes:0};
    })().then(value=>{clearTimeout(timer);finish(value);}).catch(()=>{clearTimeout(timer);finish({status:'FAIL',stage:'read-or-assertion'});});`;
  const result = await promisify(execFile)('/Users/tomhall-taylor/.fly/bin/flyctl', [
    'ssh', 'console', '-a', 'unc-worker', '--machine', '1857466fd76998', '--quiet', '-C',
    `node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`,
  ], { timeout: 40000, maxBuffer: 1048576 });
  console.log(JSON.stringify(JSON.parse(result.stdout.trim()), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error(JSON.stringify({ status: 'FAIL', stage: 'read-or-assertion', providerCalls: 0, writes: 0 })); process.exitCode = 1; });
}
