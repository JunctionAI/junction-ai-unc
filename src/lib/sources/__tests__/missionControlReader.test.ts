import { describe,expect,it,vi } from "vitest";
import { readMissionControlEmailCampaigns } from "../missionControl";

const A="00000000-0000-4000-8000-000000000002";
const source={contract:"junction.source.email-campaigns.v1",accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",dataset:"email_campaigns",sourceRowCount:86,sourceMaxUpdatedAt:"2026-09-05T19:08:11Z",rows:[],bridgeFetchedAt:"2026-09-06T01:00:00Z",bridgeDeploymentId:"dep-1"};
const ENV={MISSION_CONTROL_SOURCE_URL:"https://ebcatvidixdjjwmmades.supabase.co/functions/v1/unc-source-read",MISSION_CONTROL_SOURCE_TOKEN:"x".repeat(32)};

describe("mission control source reader",()=>{
  it("validates exact configuration, identity and response",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(source),{status:200,headers:{"content-type":"application/json"}}));
    await expect(readMissionControlEmailCampaigns({accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",limit:1},{env:ENV,fetch:fetcher})).resolves.toMatchObject({accountId:A,sourceRowCount:86});
    expect(fetcher).toHaveBeenCalledWith(ENV.MISSION_CONTROL_SOURCE_URL,expect.objectContaining({method:"POST",headers:expect.objectContaining({authorization:`Bearer ${ENV.MISSION_CONTROL_SOURCE_TOKEN}`})}));
  });
  it("refuses missing configuration, foreign identity and oversized output",async()=>{
    const fetcher=vi.fn();
    await expect(readMissionControlEmailCampaigns({accountId:A,sourceProject:"wrong",sourceKind:"junction.client_orgs",sourceKey:"h1",limit:1},{env:ENV,fetch:fetcher})).rejects.toThrow();
    await expect(readMissionControlEmailCampaigns({accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",limit:1},{env:{},fetch:fetcher})).rejects.toThrow();
    fetcher.mockResolvedValue(new Response("x".repeat(2_000_001),{status:200}));
    await expect(readMissionControlEmailCampaigns({accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",limit:1},{env:ENV,fetch:fetcher})).rejects.toThrow("too large");
  });
});
