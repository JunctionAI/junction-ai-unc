/** Read-only operator preflight on the existing Fly worker. Never issues a permit,
 * calls the webhook/provider, changes a flag or unpauses an account. Secrets stay
 * in the worker. A PASS here is configuration readiness, not E2E/auth proof.
 * FLY_BIN=/path/to/flyctl node scripts/verify-keyword-pilot-readiness.mjs
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

// Self-contained so the reviewed function can run against the deployed modules.
export async function inspectKeywordPilot({env, pin, readJson, readAccount, digest}) {
  const blockers = [];
  const flagNames = ['UNC_COMMANDS_ENABLED','UNC_MESSAGING_ENABLED','LIVE_MODE_ENABLED','TNZ_SMS_ENABLED','APPLE_MESSAGES_ENABLED'];
  const flagsOff = flagNames.every(name => env[name] === 'false');
  if (!flagsOff) blockers.push('external_action_flags_not_off');
  const buildSha = env.UNC_BUILD_SHA;
  if (!/^[a-f0-9]{40}$/.test(buildSha ?? '')) blockers.push('worker_build_unknown');
  const origin = 'https://junction-unc.vercel.app';
  const api = 'https://junctionai8.app.n8n.cloud/api/v1';
  const accountId = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  const nodeId = 'c934c229-1191-43b7-b035-5fc641fbe0d0';
  if (env.N8N_DATA_BASE_URL !== origin || env.N8N_SHADOW_RECEIVER_URL !== pin.receiverUrl)
    blockers.push('receiver_or_authority_origin_mismatch');
  const token = env.N8N_SHADOW_RECEIVER_TOKEN ?? '';
  const signing = env.N8N_SIGNING_SECRET ?? '';
  if (token.length < 24 || /\s/.test(token) || token === signing || signing.length < 32)
    blockers.push('receiver_or_signing_format_invalid');
  if (env.N8N_EXECUTION_READER_ENABLED !== 'true') blockers.push('execution_reader_disabled');
  const key = env.N8N_EXECUTION_API_KEY ?? '';
  const expiry = Date.parse(env.N8N_EXECUTION_API_KEY_EXPIRES_AT ?? '');
  const apiConfigured = env.N8N_EXECUTION_API_BASE_URL === api && key.length >= 24 && !/\s/.test(key) &&
    env.N8N_SHADOW_WORKFLOW_ID === pin.workflowId && env.N8N_SHADOW_TRIGGER_NODE_ID === nodeId &&
    Number.isFinite(expiry) && expiry > Date.now() + 600_000;
  if (!apiConfigured) blockers.push('execution_reader_configuration_invalid');
  const health = await readJson(origin + '/api/health');
  if (!health.ok || !health.db?.ok || !health.worker?.fresh || health.build?.sha !== buildSha?.slice(0,12))
    blockers.push('app_worker_release_or_health_mismatch');
  let observedRevision = null, ignoreBots = null, revisionReview = null;
  if (apiConfigured) {
    const workflow = await readJson(api + '/workflows/' + encodeURIComponent(pin.workflowId), {'X-N8N-API-KEY':key});
    observedRevision = workflow.activeVersionId ?? null;
    if (workflow.id !== pin.workflowId || workflow.active !== true ||
        workflow.versionId !== pin.workflowVersion || workflow.activeVersionId !== pin.workflowVersion)
      blockers.push('published_revision_requires_review_and_repin');
    const node = workflow.nodes?.find(n => n.id === nodeId);
    ignoreBots = node?.parameters?.options?.ignoreBots ?? false;
    if (node?.type !== 'n8n-nodes-base.webhook' || node.parameters?.authentication !== 'headerAuth' ||
        node.parameters?.httpMethod !== 'POST' || node.parameters?.path !== 'unc/d03-w01/keyword-shadow' ||
        node.parameters?.responseMode !== 'responseNode' || node.credentials?.httpHeaderAuth?.id !== 'Y9Xu3zApLSrcWu1e')
      blockers.push('webhook_binding_mismatch');
    // Never spoof a browser UA. The intended caller is a server, not a browser.
    if (ignoreBots !== false) blockers.push('webhook_blocks_server_user_agents');
    // Compare only the reviewed definition, not changing metadata/timestamps. Hash
    // exact parameter/credential references without exporting their contents.
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
    const definition = {nodes:workflow.nodes,connections:workflow.connections ?? {},settings:workflow.settings ?? {},pinData:workflow.pinData ?? {}};
    const normalized = structuredClone(definition);
    const normalizedHook = normalized.nodes?.find(n=>n.id===nodeId);
    if (normalizedHook) normalizedHook.parameters.options = {...normalizedHook.parameters.options,ignoreBots:false};
    revisionReview = {algorithm:'sha256-canonical-json-v1',
      definitionHash:digest(JSON.stringify(canonical(definition))),
      ignoringOnlyIgnoreBotsHash:digest(JSON.stringify(canonical(normalized)))};
  }
  const account = await readAccount(accountId);
  if (!account || account.automationPaused) blockers.push('account_paused_or_missing');
  if (account?.account?.contextGeneration !== 1 ||
      !['avgarsport.com','https://avgarsport.com','https://avgarsport.com/'].includes(account?.vars?.website))
    blockers.push('pilot_context_mismatch');
  return {status:blockers.length ? 'BLOCKED' : 'PASS', kind:'read_only_configuration_preflight',
    checkedAt:new Date().toISOString(), accountId, generation:account?.account?.contextGeneration ?? null,
    expectedRevision:pin.workflowVersion, observedRevision, ignoreBots, revisionReview, buildSha:buildSha ?? null,
    flagsOff, blockers, providerCalls:0, permitsIssued:0, receiverAuthenticationProven:false,
    endToEndProven:false};
}

export async function remotePreflight(inspect, load, env) {
  const {KEYWORD_PILOT_PIN:pin} = load('/app/dist/worker/worker/issueKeywordShadowPilot.js');
  const {serviceDb} = load('/app/dist/worker/worker/wiring.js');
  const {DbAccountsSource} = load('/app/dist/worker/worker/accounts.js');
  const db = serviceDb();
  if (!db) throw new Error('database unavailable');
  const accounts = new DbAccountsSource(db);
  const readJson = async (url, headers = {}) => {
    const response = await fetch(url,{method:'GET',redirect:'error',cache:'no-store',headers,signal:AbortSignal.timeout(15000)});
    if (!response.ok || !response.body) throw new Error('read failed');
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 1048576) throw new Error('read too large');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  return inspect({env,pin,readJson,readAccount:id=>accounts.getAccount(id),
    digest:text=>load('node:crypto').createHash('sha256').update(text).digest('hex')});
}

async function main() {
  if (process.argv.length !== 2) throw new Error('No arguments supported; this is read-only.');
  const exec = promisify(execFile), cli = process.env.FLY_BIN ?? 'fly';
  const app = 'unc-worker', machine = '1857466fd76998';
  const run = async args => (await exec(cli,args,{timeout:60000,maxBuffer:1048576})).stdout;
  const before = JSON.parse(await run(['status','-a',app,'--json']));
  const m = before.Machines?.[0];
  if (before.Name !== app || before.Machines?.length !== 1 || m?.id !== machine || m.state !== 'started')
    throw new Error('Unexpected topology');
  const program = `(${remotePreflight.toString()})(${inspectKeywordPilot.toString()},require,process.env).then(r=>console.log(JSON.stringify(r))).catch(()=>console.log(JSON.stringify({status:"FAIL",error:"Read-only preflight failed; raw transport details suppressed",providerCalls:0,permitsIssued:0})));`;
  const encoded = Buffer.from(program).toString('base64');
  const report = JSON.parse((await run(['ssh','console','-a',app,'--machine',machine,'--quiet','-C',
    `node -e 'eval(Buffer.from("${encoded}","base64").toString())'`])).trim());
  const after = JSON.parse(await run(['status','-a',app,'--json']));
  const latest = after.Machines?.[0];
  if (after.Machines?.length !== 1 || latest?.id !== machine || latest.state !== 'started' ||
      latest.config.image !== m.config.image || latest.config.metadata?.fly_release_version !== m.config.metadata?.fly_release_version)
    throw new Error('Worker changed during verification');
  console.log(JSON.stringify({...report,workerRelease:latest.config.metadata?.fly_release_version},null,2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{console.error(JSON.stringify({status:'FAIL',error:'Read-only preflight failed; no webhook or provider call requested.'}));process.exitCode=1;});
}
