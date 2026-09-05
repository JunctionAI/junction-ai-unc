/** Supported API GET-only verification. No raw provider output or credential
 * values are emitted. This never runs the probe or creates an Unc allowance. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonical, normalizedParameters, inspectDefinition } from './verify-calendar-receiver-workflow.mjs';
import { buildCalendarCampaignProbe } from './lib/calendar-campaign-probe.mjs';
import { buildCalendarReceiverBundle } from './lib/calendar-receiver-bundle.mjs';

export const CAMPAIGN_PROBE_ID = 'Jx7LgmNcyz3Y6d42';
/** Execution 98 resolves these exact node defaults into its saved snapshot.
 * Remove only the observed no-op values; changed values still fail the hash. */
export function normalizeCampaignSnapshotNode(node) {
  const n = structuredClone(node), p = n.parameters;
  if (n.type === 'n8n-nodes-base.manualTrigger' && p.notice === '') delete p.notice;
  if (n.type === 'n8n-nodes-base.httpRequest' && n.typeVersion === 4.5) {
    for (const [key, value] of Object.entries({ curlImport: '', provideSslCertificates: false,
      sendQuery: false, specifyHeaders: 'keypair', sendBody: false, infoMessage: '' }))
      if (p[key] === value) delete p[key];
    if (p.options?.pagination?.pagination?.webhookNotice === '') delete p.options.pagination.pagination.webhookNotice;
  }
  return n;
}
export function campaignProbeExpectations() {
  const w = buildCalendarCampaignProbe(), hash = v => createHash('sha256').update(canonical(v)).digest('hex');
  return { id: CAMPAIGN_PROBE_ID, name: w.name, settings: w.settings, connectionsHash: hash(w.connections),
    nodes: w.nodes.map(n => ({ name: n.name, type: n.type, typeVersion: n.typeVersion,
      parametersHash: hash(normalizedParameters(n)), credentialsHash: hash(n.credentials ?? {}),
      onError: n.onError ?? 'stopWorkflow', executeOnce: n.executeOnce === true, retryOnFail: n.retryOnFail === true })) };
}

export function campaignProbeOutput(e, api) {
  const check = (v, name) => { if (!v) throw new Error('campaign_probe_' + name); };
  check(e.workflowId === 'Jx7LgmNcyz3Y6d42' && e.finished === true && e.mode === 'manual' && !e.retryOf && !e.retrySuccessId, 'identity');
  check(typeof e.id === 'string' && /^[1-9]\d{0,10}$/.test(e.id) &&
    typeof e.workflowVersionId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(e.workflowVersionId), 'execution_revision');
  const start = Date.parse(e.startedAt), stop = Date.parse(e.stoppedAt);
  check(Number.isFinite(start) && Number.isFinite(stop) && stop >= start && stop - start <= 40000, 'execution_window');
  check(!Object.keys(e.data?.pinData ?? {}).length && !e.data?.redactionInfo?.isRedacted && !e.dataTooLargeToDisplay, 'unredacted_unpinned');
  const runs = e.data?.resultData?.runData;
  check(runs && Object.keys(runs).length === 2 && runs['Start watched campaign read']?.length === 1 &&
    runs['Read AVGAR sent campaign metadata']?.length === 1, 'run_nodes');
  const task = runs['Read AVGAR sent campaign metadata'][0];
  check(runs['Start watched campaign read'][0].executionStatus === 'success' && !runs['Start watched campaign read'][0].error &&
    Number.isFinite(task.executionTime) && task.executionTime >= 0 && task.executionTime <= 40000, 'task_state');
  if (e.status !== 'success' || task.executionStatus !== 'success') {
    const err = task.error ?? e.data?.resultData?.error;
    return { status: 'FAIL', executionId: e.id, actualRevision: e.workflowVersionId,
      reason: 'native_campaign_read_failed', httpStatus: /^\d{3}$/.test(String(err?.httpCode)) ? Number(err.httpCode) : null };
  }
  check(!e.data?.resultData?.error && !task.error && task.data?.main?.length === 1 && task.source?.length === 1 &&
    task.source[0].previousNode === 'Start watched campaign read' && task.source[0].previousNodeOutput === 0 && task.source[0].previousNodeRun === 0, 'node_status');
  const pages = task.data.main[0];
  check(Array.isArray(pages) && pages.length > 0 && pages.length <= 5, 'page_count');
  const seen = new Set();
  const report = pages.map((p, index) => {
    const v = p.json;
    check(v.statusCode === 200 && v.headers?.cid === 'SuYidF' && v.headers?.['x-klaviyo-api-revision'] === '2026-07-15', 'provider_identity');
    check(Array.isArray(v.body?.data) && Object.hasOwn(v.body?.links ?? {}, 'next'), 'page_shape');
    for (const c of v.body.data) {
      check(c.type === 'campaign' && typeof c.id === 'string' && !seen.has(c.id), 'campaign_identity'); seen.add(c.id);
      check(c.attributes?.status === 'Sent' && typeof c.attributes.name === 'string', 'campaign_metadata');
    }
    return { page: index + 1, statusCode: v.statusCode, items: v.body.data.length,
      complete: v.body.links.next === null,
      sendTimeTypes: [...new Set(v.body.data.map(c => c.attributes.send_time === null ? 'null' : typeof c.attributes.send_time))],
      missingSendTimes: v.body.data.filter(c => !c.attributes.send_time).length,
      archiveTypes: [...new Set(v.body.data.map(c => typeof c.attributes.archived))] };
  });
  // Offline input compatibility only: these clocks delimit the saved manual read,
  // not an invented Unc authority response, permit, run or business artifact.
  const history = api.collectCalendarCampaigns(pages.map(p => p.json), {
    run: { startedAt: e.startedAt }, authorizedAt: e.startedAt,
    expiresAt: new Date(Date.parse(e.stoppedAt) + 1000).toISOString(),
    shadow: { client: { klaviyoAccountId: 'SuYidF' } },
  }, e.stoppedAt);
  return { status: report.at(-1).complete ? 'PASS' : 'PARTIAL', workflowId: e.workflowId,
    executionId: e.id, actualRevision: e.workflowVersionId, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
    milliseconds: task.executionTime, pages: report, totalCampaigns: seen.size, providerAccountId: 'SuYidF',
    recentCampaigns: history.rows.length, receiverInputCompatible: true,
    calendarEndToEndAccepted: false, providerMutations: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (process.argv.length > 3 || arg && !/^(latest|[1-9]\d{0,10})$/.test(arg)) throw Error('Expected execution ID or latest');
  const bundle = buildCalendarReceiverBundle();
  const source = `const canonical=${canonical.toString()},normalizedParameters=${normalizedParameters.toString()},inspectDefinition=${inspectDefinition.toString()},campaignProbeOutput=${campaignProbeOutput.toString()},normalizeCampaignSnapshotNode=${normalizeCampaignSnapshotNode.toString()},api=${bundle.expression};
    (async()=>{const expected=${JSON.stringify(campaignProbeExpectations())},base=process.env.N8N_EXECUTION_API_BASE_URL;if(base!=='https://junctionai8.app.n8n.cloud/api/v1')throw Error();
    const hash=v=>require('node:crypto').createHash('sha256').update(canonical(v)).digest('hex');
    async function get(path){const r=await fetch(base+path,{headers:{'X-N8N-API-KEY':process.env.N8N_EXECUTION_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();let size=0;const chunks=[];for await(const p of r.body){size+=p.length;if(size>2000000)throw Error();chunks.push(Buffer.from(p));}return JSON.parse(Buffer.concat(chunks).toString());}
    const w=await get('/workflows/'+expected.id),definition=inspectDefinition(w,expected,hash,normalizedParameters);console.log(JSON.stringify({definition,at:new Date().toISOString()}));if(definition.status!=='PASS'){process.exitCode=1;return;}
    let id=${JSON.stringify(arg ?? null)};if(id==='latest')id=(await get('/executions?workflowId='+expected.id+'&limit=1')).data?.[0]?.id;
    if(id){if(!/^\\d{1,11}$/.test(id))throw Error();const e=await get('/executions/'+id+'?includeData=true');
      const snapshot=structuredClone(e.workflowData);snapshot.nodes=snapshot.nodes.map(normalizeCampaignSnapshotNode);
      const d=inspectDefinition({...snapshot,versionId:e.workflowVersionId,active:false},expected,hash,normalizedParameters);if(d.status!=='PASS'){
        const paths=[];const diff=(a,b,p)=>{if(canonical(a)===canonical(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],p+'.'+k);}else paths.push({path:p,saved:typeof b==='boolean'||['','keypair'].includes(b)?b:'unprojected'});};
        for(const n of w.nodes){const saved=snapshot.nodes.find(x=>x.name===n.name);if(saved)diff(normalizedParameters(n),normalizedParameters(saved),n.name);}
        console.log(JSON.stringify({status:'FAIL',reason:'snapshot_mismatch',failures:d.failures,parameterPaths:paths,executionId:e.id}));process.exitCode=1;return;}
      const result=campaignProbeOutput(e,api);console.log(JSON.stringify({...result,receiverBundleHash:${JSON.stringify(bundle.sha256)}}));if(result.status!=='PASS')process.exitCode=1;}
    })().catch(e=>{console.log(JSON.stringify({status:'FAIL',reason:/^(campaign_probe|calendar_receiver)_[a-z_]+$/.test(e.message)?e.message:'read_or_shape_failure'}));process.exitCode=1;});`;
  try { console.log(execFileSync('/Users/tomhall-taylor/.fly/bin/flyctl', ['ssh','console','-a','unc-worker','--machine','1857466fd76998','--quiet','-C',
    `node -e 'eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString())'`],
  { encoding:'utf8', timeout:55000, stdio:['ignore','pipe','pipe'] })); }
  catch (error) {
    // Only forward our JSON projections, never the transport command or stderr.
    for (const line of String(error.stdout ?? '').trim().split('\n')) {
      try { const p = JSON.parse(line); if (p.status === 'FAIL' || p.status === 'PARTIAL' || p.definition) console.log(JSON.stringify(p)); } catch {}
    }
    console.log(JSON.stringify({status:'FAIL',reason:'verification_incomplete'}));process.exitCode=1;
  }
}
