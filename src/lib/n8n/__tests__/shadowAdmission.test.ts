import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { DbShadowAdmission, shadowTokenDigest, type ShadowAdmission } from "../shadowAdmission";
import { AVGAR_PILOT_ACCOUNT, type KeywordShadowContract } from "../shadowContract";
import { HttpN8nBridge } from "../../../worker/providers/n8n";
import { shadowRequestDigest } from "../executionEvidence";
import type { N8nNode, RunContext } from "../../runtime/types";

const NOW = new Date('2026-09-05T07:00:02Z');
const START = '2026-09-05T07:00:00Z';
const contract: KeywordShadowContract = { contract:'unc.keyword-shadow.v1', accountId:AVGAR_PILOT_ACCOUNT,
  routineId:'D03-W01', routineKey:'keyword_opportunity', workflowId:'synthetic-wrapper', workflowVersion:'synthetic-pin',
  client:{id:'avgar',primaryDomain:'example.com',seedKeyword:'test keyword',locationCode:2840,languageCode:'en'} };
const ctx: RunContext = {runId:'synthetic-run', routineId:'D03-W01',version:1,mode:'dry_run',startedAt:START,triggeredBy:'manual',
  account:{accountId:AVGAR_PILOT_ACCOUNT,contextGeneration:1,currency:'NZD',budgetMonthly:0},
  caps:{currency:'NZD',perDay:0,perMonth:0},inputs:{},vars:{},reads:{},checks:{}};
const node: N8nNode = {id:'produce',kind:'n8n',shadowContract:contract};
const workflow = {id:'synthetic-registration',accountId:AVGAR_PILOT_ACCOUNT,routineId:'D03-W01',active:true,webhookUrl:'https://n8n.test/keyword'};
const env = {N8N_SIGNING_SECRET:'synthetic-root',N8N_SHADOW_RECEIVER_TOKEN:'synthetic-receiver-key-24-plus',
  N8N_SHADOW_RECEIVER_URL:workflow.webhookUrl,N8N_DATA_BASE_URL:'https://unc.test'};

function fixture() {
  const db = new FakeSupabase();
  let state='reserved', issued=true, paid=0;
  let request: Parameters<ShadowAdmission['claim']>[0];
  let saved: unknown; let seenExecution: unknown;
  // Atomic fake RPC outcomes exercise the wiring. SQL semantics are tested separately
  // by verify-keyword-shadow-admission.sql on PostgreSQL, not inferred from this fake.
  db.rpcs.claim_keyword_shadow_dispatch = ({input}) => {
    if (!issued || state!=='reserved') return null;
    request=structuredClone(input) as typeof request; state='dispatching'; return 'synthetic-permit';
  };
  db.rpcs.consume_keyword_shadow_authority = ({input}) => {
    const x=input as typeof request;
    if(state!=='dispatching' || x.tokenDigest!==request.tokenDigest) return false;
    state='provider_authorized'; return true;
  };
  db.rpcs.finish_keyword_shadow_dispatch = args => {
    if (!['dispatching','provider_authorized','verifying','uncertain'].includes(state)) return false;
    state=String(args.outcome); saved=args.saved_result; seenExecution=args.observed_execution; return true;
  };
  db.rpcs.checkpoint_keyword_shadow_result = args => {
    if (state!=='provider_authorized') return false;
    state='verifying'; seenExecution=args.observed_execution; return true;
  };
  const admission=new DbShadowAdmission(db);
  const fetch=vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const payload=JSON.parse(String(init?.body));
    expect(request.requestDigest).toBe(shadowRequestDigest(payload));
    const allowed=await admission.authorize({...request,specHash:'synthetic-hash',tokenDigest:shadowTokenDigest(payload.dataToken)});
    if(!allowed) return Response.json({error:'denied'},{status:409});
    paid++;
    return Response.json({artifact:{kind:'keyword_list',title:'Test keywords',body:'Synthetic provider evidence only.',items:[{title:'test keyword',body:'Synthetic keyword.'}]},
      executionReceipt:{contract:contract.contract,accountId:ctx.account.accountId,runId:ctx.runId,routineId:ctx.routineId,
        routineKey:contract.routineKey,workflowId:contract.workflowId,workflowVersion:null,revisionEvidence:'pending_unc_verification',executionId:'123',
        mode:'dry_run',status:'succeeded',executedAction:'none',startedAt:START,finishedAt:NOW.toISOString(),client:contract.client,
        provider:{name:'dataforseo',taskId:'synthetic-task',statusCode:20000,taskStatusCode:20000,itemsCount:1,fetchedAt:NOW.toISOString()}}});
  });
  const read=vi.fn(async () => ({source:'n8n_execution_record',executionId:'123',workflowId:contract.workflowId,workflowVersion:contract.workflowVersion,
    status:'success',finished:true,startedAt:START,stoppedAt:NOW.toISOString(),request:{accountId:ctx.account.accountId,runId:ctx.runId,routineId:ctx.routineId},requestDigest:request.requestDigest}));
  const bridge=() => new HttpN8nBridge({env,now:()=>NOW,fetch,readShadowExecution:read,shadowAdmission:admission});
  return {db,admission,fetch,read,bridge,unissue:()=>{issued=false;},state:()=>state,paid:()=>paid,saved:()=>saved,execution:()=>seenExecution};
}

describe('durable keyword admission wiring', () => {
  it('refuses absent registration, absent admission or an unissued permit before POST', async () => {
    const f=fixture();
    await expect(f.bridge().call(node,ctx,null)).rejects.toThrow('account-specific');
    await expect(new HttpN8nBridge({env,readShadowExecution:f.read,fetch:f.fetch}).call(node,ctx,workflow)).rejects.toThrow('admission');
    f.unissue();
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('two independent bridge instances sharing storage dispatch once', async () => {
    const f=fixture();
    const result=await Promise.allSettled([f.bridge().call(node,ctx,workflow),f.bridge().call(node,ctx,workflow)]);
    expect(result.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.paid()).toBe(1); expect(f.state()).toBe('verified');
    expect(f.saved()).toMatchObject({kind:'artifact',artifact:{meta:{executionReceipt:{revisionEvidence:'verified_execution_record'}}}});
    expect(f.execution()).toBe('123');
    expect(JSON.stringify(f.db.calls)).not.toContain('unc_dt.');
    expect(JSON.stringify(f.db.calls)).not.toContain(env.N8N_SHADOW_RECEIVER_TOKEN);
  });
  it('network ambiguity consumes the dispatch permanently and records uncertainty', async () => {
    const f=fixture(); f.fetch.mockRejectedValue(new Error('private transport contents'));
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unreachable');
    expect(f.state()).toBe('uncertain');
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.saved()).toBeNull();
  });
  it('retains the reported execution identity when independent evidence is unavailable', async () => {
    const f=fixture(); f.read.mockImplementation(async () => {
      expect(f.state()).toBe('verifying'); expect(f.execution()).toBe('123');
      throw new Error('private credential error');
    });
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('independently verified');
    expect(f.state()).toBe('uncertain'); expect(f.execution()).toBe('123');
    expect(JSON.stringify(f.db.calls)).not.toContain('private credential error');
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.paid()).toBe(1);
  });
  it('does not release an artifact or permit when result persistence fails', async () => {
    const f=fixture(); f.db.rpcs.finish_keyword_shadow_dispatch=()=>{throw new Error('storage unavailable');};
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('storage unavailable');
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.paid()).toBe(1);
  });
  it('revocation between dispatch and authority stops before the paid provider', async () => {
    const f=fixture(); f.db.rpcs.consume_keyword_shadow_authority=()=>false;
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('answered 409');
    expect(f.paid()).toBe(0); expect(f.state()).toBe('uncertain');
  });
  it('lost claim response cannot be retried as a fresh dispatch', async () => {
    const f=fixture(); const claim=f.db.rpcs.claim_keyword_shadow_dispatch;
    f.db.rpcs.claim_keyword_shadow_dispatch=args=>{claim(args);throw new Error('claim response lost');};
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('claim response lost');
    f.db.rpcs.claim_keyword_shadow_dispatch=claim;
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('checkpoint failure does not return an artifact or retry the paid call', async () => {
    const f=fixture(); f.db.rpcs.checkpoint_keyword_shadow_result=()=>false;
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('not checkpointed');
    expect(f.read).not.toHaveBeenCalled(); expect(f.state()).toBe('uncertain');
    await expect(f.bridge().call(node,ctx,workflow)).rejects.toThrow('unused shadow permit');
    expect(f.paid()).toBe(1);
  });
});
