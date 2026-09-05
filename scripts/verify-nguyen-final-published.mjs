/** Read only the handed-off workflow definition using the existing server key.
 * No credentials leave the worker. No execution, pin, or registration mutation. */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const cli = '/Users/tomhall-taylor/.fly/bin/flyctl';
const oldCode = (await readFile(new URL('../docs/integration/deliveries/nguyen-2026-09-06/D03-W01_build_artifact_corrected_jscode.js.txt', import.meta.url), 'utf8')).trim();
const deliveredCode = (await readFile(new URL('../docs/integration/deliveries/nguyen-2026-09-06-final/d03/D03-W01_build_artifact_final_jscode.js.txt', import.meta.url), 'utf8')).trim();
async function inspect(previousCode, expectedCode) {
  // Serialized into a CommonJS node -e command on the existing worker.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const assert = require('node:assert/strict'), crypto = require('node:crypto');
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const flags = ['UNC_COMMANDS_ENABLED', 'UNC_MESSAGING_ENABLED', 'LIVE_MODE_ENABLED', 'TNZ_SMS_ENABLED', 'APPLE_MESSAGES_ENABLED'];
  for (const name of flags) assert.equal(process.env[name], 'false');
  const api = 'https://junctionai8.app.n8n.cloud/api/v1';
  assert.equal(process.env.N8N_EXECUTION_API_BASE_URL, api);
  assert.ok(process.env.N8N_EXECUTION_API_KEY?.length > 24);
  const response = await fetch(api + '/workflows/XiXJKuph1fAeH9pe', {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { accept: 'application/json', 'X-N8N-API-KEY': process.env.N8N_EXECUTION_API_KEY }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200); let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= 1048576); chunks.push(Buffer.from(chunk)); }
  const workflow = JSON.parse(Buffer.concat(chunks).toString());
  const revision = 'ac771cd3-8899-4401-915c-40d4477e48e2';
  assert.equal(workflow.id, 'XiXJKuph1fAeH9pe'); assert.equal(workflow.active, true);
  assert.equal(workflow.versionId, revision); assert.equal(workflow.activeVersionId, revision);
  const builder = workflow.nodes.filter(n => n.id === 'af132442-1901-466e-a3d1-84750e50abdd' && n.name === 'Build Artifact And Receipt');
  if (builder.length !== 1) return {status:'BUILDER_NOT_FOUND',nodes:workflow.nodes.map(n=>({id:n.id,name:n.name,type:n.type}))};
  const builderHash = hash(builder[0].parameters.jsCode.trim());
  const normalizedBuilderHash = hash(builder[0].parameters.jsCode.replace(/\r\n/g,'\n').trim());
  if (normalizedBuilderHash !== '8668beead72a6d83862039f40a07ea76f42dc24244a52b6644870cbfbc0bf497') {
    const actual = builder[0].parameters.jsCode.replace(/\r\n/g,'\n').trim();
    assert.ok(!/(?:sk-[A-Za-z0-9]{24,}|-----BEGIN.*PRIVATE KEY|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.)/.test(actual));
    const a=actual.split('\n'), e=expectedCode.split('\n');
    const differences = a.flatMap((line,i)=>line===e[i]?[]:[{line:i+1,actual:line.slice(0,250),delivered:e[i]?.slice(0,250)}]);
    return {status:'BUILDER_HASH_MISMATCH',checkedAt:new Date().toISOString(),revision,builderHash,normalizedBuilderHash,actualLines:a.length,deliveredLines:e.length,differenceCount:differences.length,differences:differences.slice(0,12)};
  }
  const definition = { nodes: workflow.nodes, connections: workflow.connections ?? {}, settings: workflow.settings ?? {}, pinData: workflow.pinData ?? {} };
  const definitionHash = hash(JSON.stringify(canonical(definition)));
  const prior = structuredClone(definition), priorBuilder = prior.nodes.find(n => n.id === builder[0].id);
  const reconstructions = [previousCode, previousCode + '\n'].map(code => {
    priorBuilder.parameters.jsCode = code; return hash(JSON.stringify(canonical(prior)));
  });
  const onlyBuilderChanged = reconstructions.includes('fac94aaa603e5497004428213c2b665d95919aa6779b6007836526ce299d5301');
  const hook = workflow.nodes.find(n => n.id === 'c934c229-1191-43b7-b035-5fc641fbe0d0');
  assert.equal(hook?.parameters?.authentication, 'headerAuth'); assert.equal(hook?.parameters?.httpMethod, 'POST');
  assert.equal(hook?.parameters?.path, 'unc/d03-w01/keyword-shadow');
  assert.equal(hook?.credentials?.httpHeaderAuth?.id, 'Y9Xu3zApLSrcWu1e');
  return { status: onlyBuilderChanged ? 'PASS' : 'DEFINITION_DIFF_REVIEW_REQUIRED', checkedAt: new Date().toISOString(),
    workflowId: workflow.id, revision, builderHash, definitionHash, onlyBuilderChanged, reconstructions,
    deliveredExportExact:false, acceptedDifference:'task-error diagnostic uses taskStatusCode; reviewed published builder hash is authoritative',
    nodeCount: workflow.nodes.length, headerCredentialUnchanged: true, externalActionFlagsOff: true,
    n8nReads: 1, providerCalls: 0, executionRequests: 0, writes: 0 };
}
const source = `const finish=r=>process.stdout.write(JSON.stringify(r)+'\\n',()=>process.exit(r.status==='PASS'?0:1));const timer=setTimeout(()=>finish({status:'FAIL',stage:'remote-timeout'}),22000);(${inspect.toString()})(${JSON.stringify(oldCode)},${JSON.stringify(deliveredCode)}).then(r=>{clearTimeout(timer);finish(r);}).catch(()=>{clearTimeout(timer);finish({status:'FAIL',stage:'published-read-or-assertion'});});`;
try {
  const { stdout } = await exec(cli, ['ssh','console','-a','unc-worker','--machine','1857466fd76998','--quiet','-C',
    `node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`], { timeout: 35000, maxBuffer: 1048576 });
  console.log(JSON.stringify(JSON.parse(stdout.trim()), null, 2));
} catch (error) {
  let report = { status: 'FAIL', stage: 'transport', timedOut: error?.killed === true };
  try {
    const r = JSON.parse(error?.stdout?.trim());
    if (['DEFINITION_DIFF_REVIEW_REQUIRED','BUILDER_NOT_FOUND','BUILDER_HASH_MISMATCH'].includes(r.status)) report = r;
    else if (r.stage === 'published-read-or-assertion' || r.stage === 'remote-timeout') report.stage = r.stage;
  } catch { /* Suppress raw authenticated responses and transport errors. */ }
  console.error(JSON.stringify(report)); process.exitCode = 1;
}
