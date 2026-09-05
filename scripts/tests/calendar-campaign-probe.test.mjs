import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildCalendarCampaignProbe } from '../lib/calendar-campaign-probe.mjs';
import { buildCalendarReceiverBundle } from '../lib/calendar-receiver-bundle.mjs';
import { campaignProbeOutput, normalizeCampaignSnapshotNode } from '../verify-calendar-campaign-probe.mjs';

const api = vm.runInNewContext(buildCalendarReceiverBundle().expression, {}, { timeout: 1000 });
const triggerName = 'Start watched campaign read', httpName = 'Read AVGAR sent campaign metadata';
const fixture = () => ({ id:'98',workflowId:'Jx7LgmNcyz3Y6d42',workflowVersionId:'9a2c614a-7ad0-46e5-869c-4afe95919b5f',
  mode:'manual',status:'success',finished:true,startedAt:'2026-09-05T21:25:23.926Z',stoppedAt:'2026-09-05T21:25:26.215Z',
  data:{resultData:{runData:{[triggerName]:[{executionStatus:'success'}],[httpName]:[{executionStatus:'success',executionTime:2247,
    source:[{previousNode:triggerName,previousNodeOutput:0,previousNodeRun:0}],data:{main:[[{json:{statusCode:200,
      headers:{cid:'SuYidF','x-klaviyo-api-revision':'2026-07-15'},body:{data:[
        {type:'campaign',id:'synthetic-1',attributes:{status:'Sent',name:'Synthetic topic',archived:false,send_time:'2026-09-04T12:00:00Z'}},
      ],links:{next:null}}}}]]}}]}}} });
const task = e => e.data.resultData.runData[httpName][0];
const page = e => task(e).data.main[0][0].json;

test('probe is inactive, credential-bound, GET-only and bounded with no result fabrication', () => {
  const w=buildCalendarCampaignProbe();
  assert.equal(w.active,false);assert.equal(w.nodes.length,2);assert.equal(w.settings.executionTimeout,40);
  const http=w.nodes[1];assert.equal(http.parameters.method,'GET');assert.equal(http.parameters.url,api.CALENDAR_CAMPAIGN_URL);
  assert.equal(http.credentials.httpHeaderAuth.id,'4mkTKL1q0njNafh9');
  assert.equal(http.parameters.options.pagination.pagination.maxRequests,5);
  assert.equal(http.parameters.options.timeout,5000);assert.equal(http.retryOnFail,false);
  assert.equal(http.onError,'stopWorkflow');assert.equal(w.nodes.some(n=>/code|respondToWebhook|webhook|schedule/.test(n.type)),false);
});

test('saved source projection validates actual receiver input without claiming a calendar run', () => {
  const result=campaignProbeOutput(fixture(),api);
  assert.equal(result.status,'PASS');assert.equal(result.totalCampaigns,1);assert.equal(result.recentCampaigns,1);
  assert.equal(result.receiverInputCompatible,true);assert.equal(result.calendarEndToEndAccepted,false);
  assert.equal(result.providerMutations,0);assert.equal(JSON.stringify(result).includes('Synthetic topic'),false);
});

test('old sent history is counted but excluded from the actual ninety-day receiver input', () => {
  const e=fixture();page(e).body.data[0].attributes.send_time='2025-01-01T00:00:00Z';
  const result=campaignProbeOutput(e,api);assert.equal(result.totalCampaigns,1);assert.equal(result.recentCampaigns,0);
});

for(const [label,mutate] of [
  ['wrong workflow',e=>{e.workflowId='other';}],['wrong mode',e=>{e.mode='webhook';}],
  ['unfinalized',e=>{e.finished=false;}],['retry',e=>{e.retryOf='12';}],
  ['missing revision',e=>{delete e.workflowVersionId;}],['slow execution',e=>{e.stoppedAt='2026-09-05T22:25:26Z';}],
  ['pinned',e=>{e.data.pinData={x:[]};}],['redacted',e=>{e.data.redactionInfo={isRedacted:true};}],
  ['truncated',e=>{e.dataTooLargeToDisplay=true;}],['extra node',e=>{e.data.resultData.runData.extra=[];}],
  ['wrong parent',e=>{task(e).source[0].previousNode='other';}],['wrong provider',e=>{page(e).headers.cid='other';}],
  ['wrong provider revision',e=>{page(e).headers['x-klaviyo-api-revision']='2020-01-01';}],
  ['unsent campaign',e=>{page(e).body.data[0].attributes.status='Draft';}],
  ['missing send time',e=>{page(e).body.data[0].attributes.send_time=null;}],
  ['future send time',e=>{page(e).body.data[0].attributes.send_time='2027-01-01T00:00:00Z';}],
  ['incomplete pagination',e=>{page(e).body.links.next=api.CALENDAR_CAMPAIGN_URL+'&page%5Bcursor%5D=next';}],
  ['duplicate campaign',e=>{page(e).body.data.push(structuredClone(page(e).body.data[0]));}],
]) test(`rejects ${label}`,()=>{const e=fixture();mutate(e);assert.throws(()=>campaignProbeOutput(e,api));});

test('failure projections never include upstream error messages or response data',()=>{
  const e=fixture();e.status='error';task(e).executionStatus='error';task(e).error={httpCode:'403',message:'DO_NOT_EMIT_SECRET',response:{token:'DO_NOT_EMIT_SECRET'}};
  const result=campaignProbeOutput(e,api);assert.equal(result.status,'FAIL');assert.equal(result.httpStatus,403);
  assert.equal(JSON.stringify(result).includes('DO_NOT_EMIT'),false);
});

test('only exact observed Cloud defaults are removed, without mutating the input',()=>{
  const n=buildCalendarCampaignProbe().nodes[1],saved=structuredClone(n);
  Object.assign(saved.parameters,{curlImport:'',provideSslCertificates:false,sendQuery:false,specifyHeaders:'keypair',sendBody:false,infoMessage:''});
  saved.parameters.options.pagination.pagination.webhookNotice='';
  assert.deepEqual(normalizeCampaignSnapshotNode(saved),n);assert.equal(saved.parameters.sendBody,false);
  for(const [key,value] of [['sendBody',true],['provideSslCertificates',true],['specifyHeaders','json'],['curlImport','unexpected']]){
    const changed=structuredClone(saved);changed.parameters[key]=value;
    assert.notDeepEqual(normalizeCampaignSnapshotNode(changed),n);
  }
});
