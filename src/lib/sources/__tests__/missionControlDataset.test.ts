import { describe, expect, it, vi } from "vitest";
import { accountDataReader } from "../../data/datasets";
import type { DbClient } from "../../db/types";
import type { RunContext } from "../../runtime/types";
import { MissionControlDatasetReader, missionControlSourceEnabled } from "../missionControlDataset";

const A="00000000-0000-4000-8000-000000000002", B="00000000-0000-4000-8000-000000000003";
const NOW=new Date("2026-09-06T01:00:00Z");
const ENV={UNC_MISSION_CONTROL_SOURCE_ACCOUNTS:A,MISSION_CONTROL_SOURCE_URL:"https://ebcatvidixdjjwmmades.supabase.co/functions/v1/unc-source-read",MISSION_CONTROL_SOURCE_TOKEN:"x".repeat(32)};
const query={resource:"campaigns",window:"90d",fields:["id","subject","send_time","revenue"]};
const ctx:RunContext={runId:"run",routineId:"D05-W07",version:1,mode:"dry_run",startedAt:NOW.toISOString(),account:{accountId:A,contextGeneration:4,currency:"NZD",budgetMonthly:0},caps:{currency:"NZD",perDay:0,perMonth:0},triggeredBy:"manual",vars:{},inputs:{},reads:{},checks:{}};
const grant={grantId:"00000000-0000-4000-8000-000000000011",accountId:A,contextGeneration:4,bindingId:"00000000-0000-4000-8000-000000000012",sourceSystem:"mission_control",sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",platform:"klaviyo",dataset:"email_campaigns",sourceContract:"junction.source.email-campaigns.v1",maxSourceAgeMinutes:1440,bindingRevision:0};
function source(overrides:Record<string,unknown>={}) { return {contract:"junction.source.email-campaigns.v1",accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",dataset:"email_campaigns",sourceRowCount:2,sourceMaxUpdatedAt:"2026-09-05T19:08:11Z",rows:[
  {id:"new",campaignId:"c1",messageId:"m1",name:"Recent",subject:"Hello",previewText:null,sentAt:"2026-09-05T18:00:00Z",segment:null,recipients:100,openRate:.5,clickRate:.1,placedOrderRate:null,unsubscribeRate:null,spamRate:null,bounceRate:null,revenue:20,metricsUpdatedAt:"2026-09-05T19:08:11Z",updatedAt:"2026-09-05T19:08:11Z"},
  {id:"old",campaignId:"c2",messageId:"m2",name:"Older",subject:null,previewText:null,sentAt:"2026-01-01T00:00:00Z",segment:null,recipients:null,openRate:null,clickRate:null,placedOrderRate:null,unsubscribeRate:null,spamRate:null,bounceRate:null,revenue:null,metricsUpdatedAt:null,updatedAt:"2026-01-01T00:00:00Z"}
],bridgeFetchedAt:NOW.toISOString(),bridgeDeploymentId:"dep",...overrides}; }
function db(data:unknown=grant,error:null|{message:string;code?:string}=null):DbClient { return {from:()=>{throw new Error("table access forbidden")},rpc:vi.fn(async()=>({data,error}))}; }

describe("Mission Control runtime dataset reader",()=>{
  it("routes an explicitly admitted account through exact runtime authority without provider credentials",async()=>{
    const fetcher=vi.fn(async()=>Response.json(source()));
    const direct={read:vi.fn(async()=>{throw new Error("provider must not be called")})};
    const result=await accountDataReader(direct,db(),ENV,()=>NOW,{fetch:fetcher}).read("klaviyo",query,ctx);
    expect(result).toMatchObject({rows:[{id:"new",subject:"Hello",send_time:"2026-09-05T18:00:00Z",sends:null}],metrics:{count:1,matching_count:1,revenue:20},fetchedAt:"2026-09-05T19:08:11Z",provenance:"ok"});
    expect(result.sourceNote).toContain("no provider API call");
    expect(direct.read).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps admission account/query specific",()=>{
    expect(missionControlSourceEnabled(A,"klaviyo",query,ENV)).toBe(true);
    expect(missionControlSourceEnabled(B,"klaviyo",query,ENV)).toBe(false);
    expect(missionControlSourceEnabled(A,"klaviyo",{...query,filter:{tag:"winback"}},ENV)).toBe(false);
    expect(missionControlSourceEnabled(A,"shopify",query,ENV)).toBe(false);
  });
  it("fails closed on stale source, incomplete history and authority mismatch",async()=>{
    const read=(body:Record<string,unknown>,database:DbClient=db())=>new MissionControlDatasetReader(database,{env:ENV,now:()=>NOW,fetch:async()=>Response.json(body)}).read("klaviyo",query,ctx);
    await expect(read(source({sourceMaxUpdatedAt:"2026-09-04T00:00:00Z"}))).rejects.toThrow("stale");
    await expect(read(source({sourceRowCount:501}))).rejects.toThrow("complete-read bound");
    await expect(read(source(),db({...grant,accountId:B}))).rejects.toThrow("authority identity mismatch");
    await expect(read(source(),db(null,{message:"denied",code:"42501"}))).rejects.toThrow("authorize stored source read");
  });
});
