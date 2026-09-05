/** GET-only inspection of the Codex-owned calendar receiver. Never emits
 * webhook headers, run tokens, provider data, or complete saved payloads. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCalendarReceiverWorkflow } from './lib/calendar-receiver-workflow.mjs';

export const CALENDAR_DRAFT_ID = 'rQeWMo5ANO9OtUJp';
export const CALENDAR_RECEIVER_CREDENTIAL = { id: 'KbxKHh7mfemphL2W', name: 'Unc — AVGAR calendar shadow receiver' };
export const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);

// n8n Cloud 2.38.3 removes these exact default-valued fields when saving in the
// editor and adds IF's internal condition version. Do not ignore other drift.
export function normalizedParameters(n) {
  const p = structuredClone(n.parameters);
  if (n.type === 'n8n-nodes-base.set' && n.typeVersion === 3.4) {
    p.mode ??= 'manual'; p.includeOtherFields ??= false;
  }
  if (n.type === 'n8n-nodes-base.if' && n.typeVersion === 2.2) p.conditions.options.version ??= 1;
  if (n.type === 'n8n-nodes-base.httpRequest' && n.typeVersion === 4.5) {
    p.method ??= 'GET'; p.authentication ??= 'none';
    if (p.options?.response?.response) p.options.response.response.neverError ??= false;
  }
  if (n.type === 'n8n-nodes-base.code' && n.typeVersion === 2) {
    p.mode ??= 'runOnceForAllItems'; p.language ??= 'javaScript';
  }
  return p;
}

export function definitionExpectations() {
  const w = buildCalendarReceiverWorkflow(CALENDAR_RECEIVER_CREDENTIAL);
  const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
  return { id: CALENDAR_DRAFT_ID, name: w.name, settings: w.settings,
    connectionsHash: hash(w.connections), nodes: w.nodes.map(n => ({
      name: n.name, type: n.type, typeVersion: n.typeVersion, parametersHash: hash(normalizedParameters(n)),
      credentialsHash: hash(n.credentials ?? {}), onError: n.onError ?? 'stopWorkflow',
      executeOnce: n.executeOnce === true, retryOnFail: n.retryOnFail === true,
    })) };
}

export function inspectDefinition(w, expected, hash, normalize) {
  const failures = [];
  const check = (ok, name) => { if (!ok) failures.push(name); };
  check(w.id === expected.id && w.name === expected.name, 'workflow_identity');
  check(typeof w.versionId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(w.versionId), 'actual_revision');
  check(w.active === false && !w.activeVersionId && !w.isArchived, 'unpublished_draft');
  check(!Object.keys(w.pinData ?? {}).length, 'no_pinned_data');
  check(w.nodes?.length === expected.nodes.length, 'node_count');
  check(new Set(w.nodes?.map(n => n.id)).size === expected.nodes.length &&
    w.nodes?.every(n => typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(n.id)), 'node_identities');
  check(hash(w.connections) === expected.connectionsHash, 'connections');
  for (const [key, value] of Object.entries(expected.settings)) check(w.settings?.[key] === value, 'setting_' + key);
  for (const e of expected.nodes) {
    const n = w.nodes?.find(n => n.name === e.name);
    check(!!n && n.type === e.type && n.typeVersion === e.typeVersion, e.name + ':type');
    if (!n) continue;
    check(hash(normalize(n)) === e.parametersHash, e.name + ':parameters');
    check(hash(n.credentials ?? {}) === e.credentialsHash, e.name + ':credential');
    check(!n.disabled && !n.continueOnFail && !n.alwaysOutputData && (n.onError ?? 'stopWorkflow') === e.onError &&
      (n.executeOnce === true) === e.executeOnce && (n.retryOnFail === true) === e.retryOnFail, e.name + ':execution_policy');
  }
  return { status: failures.length ? 'FAIL' : 'PASS', workflowId: w.id, revision: w.versionId,
    definitionDigest: hash({ nodes: w.nodes, connections: w.connections, settings: w.settings }),
    active: w.active, failures, triggerNodeId: w.nodes?.find(n => n.name === 'Incoming calendar')?.id,
    resultNodeId: w.nodes?.find(n => n.name === 'Build calendar result')?.id,
    unattendedReady: false, note: 'Definition parity is not provider or end-to-end acceptance.' };
}

export function inspectExecution(e) {
  const runs = e.data?.resultData?.runData ?? {};
  const nodeNames = new Set(['Incoming calendar', 'Validate calendar request', 'Request is valid',
    'Authorize calendar', 'Authority allowed', 'Canonical calendar context', 'Read sent campaign pages',
    'Build calendar result', 'Return calendar', 'Return invalid request', 'Return authority refusal',
    'Return upstream failure', 'Return internal failure']);
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) ? v : null;
  const status = v => ['new', 'running', 'success', 'error', 'canceled', 'crashed', 'waiting', 'unknown'].includes(v) ? v : 'unknown';
  const code = v => Number.isInteger(v) && v >= 100 && v <= 599 ? v : undefined;
  if (!runs || typeof runs !== 'object' || Array.isArray(runs) || Object.keys(runs).length > 13)
    throw new Error('execution_shape');
  const safeError = value => {
    if (['invalid syntax', 'calendar_authority_expired', 'calendar_authority_refused',
      'calendar_upstream_error', 'calendar_processing_error'].includes(value)) return value;
    return value ? 'redacted_error' : null;
  };
  return { workflowId: id(e.workflowId), executionId: id(e.id), actualWorkflowVersion: id(e.workflowVersionId),
    status: status(e.status), finished: e.finished === true, startedAt: date(e.startedAt), stoppedAt: date(e.stoppedAt),
    pinned: !!Object.keys(e.data?.pinData ?? {}).length, retried: !!(e.retryOf || e.retrySuccessId),
    providerNodeExecuted: Object.hasOwn(runs, 'Read sent campaign pages'),
    nodes: Object.entries(runs).map(([name, entries]) => {
      if (!Array.isArray(entries) || entries.length > 20) throw new Error('execution_shape');
      return { name: nodeNames.has(name) ? name : 'unrecognized_node', attempts: entries.length,
      entries: entries.map(v => ({ status: status(v.executionStatus), milliseconds: Number.isFinite(v.executionTime) ? v.executionTime : null,
        error: safeError(v.error?.message), outputs: v.data?.main?.map(items => items.map(i => ({
          error: safeError(i.json?.error), valid: typeof i.json?.result?.valid === 'boolean' ? i.json.result.valid : undefined,
          statusCode: code(i.json?.statusCode),
        }))) })) }; }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0] && !/^(latest|[1-9]\d{0,10})$/.test(args[0])) throw new Error('Usage: node scripts/verify-calendar-receiver-workflow.mjs [executionId|latest]');
  const source = `const canonical=${canonical.toString()},normalizedParameters=${normalizedParameters.toString()},inspectDefinition=${inspectDefinition.toString()},inspectExecution=${inspectExecution.toString()};
    (async()=>{const expected=${JSON.stringify(definitionExpectations())};
    const base=process.env.N8N_EXECUTION_API_BASE_URL;if(base!=='https://junctionai8.app.n8n.cloud/api/v1')throw Error();
    const hash=v=>require('node:crypto').createHash('sha256').update(canonical(v)).digest('hex');
    async function get(path){const r=await fetch(base+path,{headers:{'X-N8N-API-KEY':process.env.N8N_EXECUTION_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const reader=r.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString());}
    const w=await get('/workflows/'+expected.id);const definition=inspectDefinition(w,expected,hash,normalizedParameters);console.log(JSON.stringify({definition,at:new Date().toISOString()}));if(definition.status!=='PASS'){process.exitCode=1;return;}
    let id=${JSON.stringify(args[0] ?? null)};if(id==='latest'){const list=await get('/executions?workflowId='+expected.id+'&limit=5');id=list.data[0]?.id;if(typeof id!=='string'||!/^\\d{1,11}$/.test(id))throw Error();}
    if(id){const e=await get('/executions/'+id+'?includeData=true');if(e.workflowId!==expected.id)throw Error();console.log(JSON.stringify({execution:inspectExecution(e)}));}
    })().catch(()=>{console.log(JSON.stringify({status:'FAIL',reason:'read_or_shape_failure'}));process.exitCode=1;});`;
  try {
    console.log(execFileSync('/Users/tomhall-taylor/.fly/bin/flyctl', ['ssh', 'console', '-a', 'unc-worker',
      '--machine', '1857466fd76998', '--quiet', '-C', `node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`],
    { encoding: 'utf8', timeout: 55000, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { console.log(JSON.stringify({ status: 'FAIL', reason: 'read_transport_failure' })); process.exitCode = 1; }
}
