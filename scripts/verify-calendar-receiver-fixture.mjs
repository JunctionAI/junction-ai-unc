/** Supported API GET-only verification of our manual, synthetic Cloud test.
 * Provider secrets and full execution payloads never leave the worker. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { buildCalendarReceiverFixture } from './lib/calendar-receiver-fixture.mjs';

export const FIXTURE_WORKFLOW_ID = 'NLOGeeBNQMURm0kL';
export const FIXTURE_TRIGGER_ID = 'ef7c652f-b120-490d-90ca-314b338e03fb';
export const FIXTURE_CODE_ID = '557254f9-a192-451d-a210-aaf7d43a0452';
export const canonicalFixture = value => Array.isArray(value) ? `[${value.map(canonicalFixture).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalFixture(value[k])}`).join(',')}}` : JSON.stringify(value);

// Serializable pure checks, run on the worker against authenticated API results.
export function verifyFixtureDefinition(w, expected, hash, snapshot = false) {
  const check = (value, name) => { if (!value) throw new Error(`fixture_verification_${name}`); };
  check(w?.id === expected.workflowId && (snapshot && w.versionId === undefined ||
    typeof w.versionId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(w.versionId)), 'workflow');
  check((snapshot ? w.active !== true : w.active === false) && !w.activeVersionId && !w.isArchived, 'inactive');
  check(!Object.keys(w.pinData ?? {}).length && w.nodes?.length === 2, 'nodes_or_pins');
  const trigger = w.nodes.find(n => n.id === expected.triggerId), code = w.nodes.find(n => n.id === expected.codeId);
  // Cloud resolves the manual trigger's empty display-only notice in snapshots.
  check(trigger?.type === 'n8n-nodes-base.manualTrigger' && trigger.typeVersion === 1 &&
    Object.entries(trigger.parameters ?? {}).every(([k, v]) => snapshot && k === 'notice' && v === ''), 'trigger');
  check(code?.type === 'n8n-nodes-base.code' && code.typeVersion === 2 &&
    (code.parameters.mode ?? 'runOnceForAllItems') === 'runOnceForAllItems' &&
    (code.parameters.language ?? 'javaScript') === 'javaScript', 'code_mode');
  check(w.nodes.every(n => !n.disabled && !n.retryOnFail && !n.continueOnFail &&
    (!n.onError || n.onError === 'stopWorkflow') && !Object.keys(n.credentials ?? {}).length), 'side_effect_boundary');
  check(hash(code.parameters.jsCode) === expected.codeHash, 'code_hash');
  check(JSON.stringify(w.connections) === JSON.stringify({ [trigger.name]: { main: [[{ node: code.name, type: 'main', index: 0 }]] } }), 'connections');
  return { workflowId: w.id, revision: w.versionId ?? null, codeHash: expected.codeHash, active: snapshot ? null : false,
    credentialBindings: 0, nodeCount: 2, triggerName: trigger.name, codeName: code.name };
}

export function verifyFixtureExecution(e, expected, hash, canonical) {
  const check = (value, name) => { if (!value) throw new Error(`fixture_execution_${name}`); };
  check(e?.id === expected.executionId && e.workflowId === expected.workflowId && e.status === 'success' && e.finished === true &&
    e.mode === 'manual' && !e.retryOf && !e.retrySuccessId && typeof e.workflowVersionId === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(e.workflowVersionId), 'identity_status');
  check(!Object.keys(e.data?.pinData ?? {}).length && !e.data?.resultData?.error, 'pins_or_error');
  // Actual Cloud execution 87 has no workflowData.versionId/active. The API's
  // top-level workflowVersionId is the actual executing revision, never an echo.
  const definition = verifyFixtureDefinition(e.workflowData, expected, hash, true);
  const data = e.data?.resultData?.runData;
  check(data && Object.keys(data).length === 2, 'run_nodes');
  for (const name of [definition.triggerName, definition.codeName]) {
    const entries = data[name];
    check(entries?.length === 1 && entries[0].executionStatus === 'success' && !entries[0].error, 'node_status');
  }
  const result = data[definition.codeName][0].data?.main;
  check(result?.length === 1 && result[0]?.length === 1, 'single_output');
  check(hash(canonical(result[0][0].json)) === expected.outputHash, 'exact_output');
  return { status: 'PASS', workflowId: e.workflowId, executionId: e.id, actualWorkflowVersion: e.workflowVersionId,
    savedDefinitionVersion: definition.revision, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
    codeMilliseconds: data[definition.codeName][0].executionTime, codeHash: expected.codeHash,
    outputHash: expected.outputHash, checksPassed: result[0][0].json.checksPassed,
    synthetic: true, providerCalls: 0, credentialBindings: 0, productionCalendarAccepted: false };
}

export function fixtureExpectations(executionId) {
  const fixture = buildCalendarReceiverFixture();
  const hash = value => createHash('sha256').update(value).digest('hex');
  // Controlled, repository-owned pure code. VM is a compatibility test, not a security sandbox.
  const output = vm.runInNewContext(`(() => { ${fixture.code} })()`, {}, { timeout: 1000 });
  return { workflowId: FIXTURE_WORKFLOW_ID, triggerId: FIXTURE_TRIGGER_ID, codeId: FIXTURE_CODE_ID,
    executionId, codeHash: hash(fixture.code), outputHash: hash(canonicalFixture(output[0].json)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !/^[1-9]\d{0,10}$/.test(args[0]))) throw new Error('Usage: node scripts/verify-calendar-receiver-fixture.mjs [executionId]');
  const expected = fixtureExpectations(args[0]);
  const source = `const verifyFixtureDefinition=${verifyFixtureDefinition.toString()};
    const verifyFixtureExecution=${verifyFixtureExecution.toString()}; const canonicalFixture=${canonicalFixture.toString()};
    (async()=>{const expected=${JSON.stringify(expected)};
    const base=process.env.N8N_EXECUTION_API_BASE_URL;
    if(base!=='https://junctionai8.app.n8n.cloud/api/v1') throw new Error('unexpected_api_origin');
    const hash=v=>require('node:crypto').createHash('sha256').update(v).digest('hex');
    async function read(path){ const r=await fetch(base+path,{headers:{'X-N8N-API-KEY':process.env.N8N_EXECUTION_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error('HTTP_'+r.status); const reader=r.body.getReader(),chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288){await reader.cancel();throw new Error('oversize_response');}chunks.push(Buffer.from(value));}
      return JSON.parse(Buffer.concat(chunks).toString()); }
    const w=await read('/workflows/'+expected.workflowId); const definition=verifyFixtureDefinition(w,expected,hash);
    const result=expected.executionId?verifyFixtureExecution(await read('/executions/'+expected.executionId+'?includeData=true'),expected,hash,canonicalFixture):{status:'PASS',...definition};
    console.log(JSON.stringify({...result,verifiedAt:new Date().toISOString()}));
    })().catch(e=>{const reason=/^(fixture_(verification|execution)_[a-z_]+|HTTP_[0-9]+|unexpected_api_origin|oversize_response)$/.test(e.message)?e.message:'verification_transport_or_shape';
      console.log(JSON.stringify({status:'FAIL',reason}));process.exitCode=1;});`;
  const command = `node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`;
  try {
    console.log(execFileSync('/Users/tomhall-taylor/.fly/bin/flyctl', ['ssh', 'console', '-a', 'unc-worker',
      '--machine', '1857466fd76998', '--quiet', '-C', command], { encoding: 'utf8', timeout: 55000, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    // Never print the shell command/base64 payload or a provider response on failure.
    let reason = 'verification_transport_or_shape';
    try { const value = JSON.parse(String(error.stdout).trim()); if (value.status === 'FAIL' && /^[a-zA-Z0-9_]+$/.test(value.reason)) reason = value.reason; } catch {}
    console.log(JSON.stringify({ status: 'FAIL', reason })); process.exitCode = 1;
  }
}
