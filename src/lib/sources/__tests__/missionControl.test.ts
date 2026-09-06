import { beforeEach,describe,expect,it,vi } from "vitest";
import type { DbClient } from "@/lib/db/types";
import type { OpsIdentity } from "@/lib/ops/session";
import { readMissionControlEmailCampaigns, type MissionControlEmailRead } from "../missionControl";

const U="00000000-0000-4000-8000-000000000001",A="00000000-0000-4000-8000-000000000002",B="00000000-0000-4000-8000-000000000003";
const binding={id:B,accountId:A,sourceSystem:"mission_control",sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",displayName:"H1",status:"verified",evidenceRef:"Verified test evidence",revision:0,verifiedAt:"2026-09-06T00:00:00Z",verifiedBy:U};
const source:MissionControlEmailRead={contract:"junction.source.email-campaigns.v1",accountId:A,sourceProject:"ebcatvidixdjjwmmades",sourceKind:"junction.client_orgs",sourceKey:"h1",dataset:"email_campaigns",sourceRowCount:86,sourceMaxUpdatedAt:"2026-09-05T19:08:11Z",rows:[],bridgeFetchedAt:"2026-09-06T01:00:00Z",bridgeDeploymentId:"dep-1"};
const rpc=vi.fn();let identity:OpsIdentity|Response;
vi.mock("@/lib/ops/session",()=>({requireOpsIdentity:async()=>identity}));
vi.mock("@/lib/sources/missionControl",async original=>{const actual=await original<typeof import("../missionControl")>();return {...actual,readMissionControlEmailCampaigns:vi.fn()};});
import { POST } from "@/app/api/ops/source-read/route";
const mockedRead=vi.mocked(readMissionControlEmailCampaigns);
const req=(body:unknown,headers:Record<string,string>={})=>new Request("https://unc.test/api/ops/source-read",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});

beforeEach(()=>{rpc.mockReset();mockedRead.mockReset();identity={userId:U,service:{rpc} as unknown as DbClient};});
describe("mission control source bridge",()=>{
  it("authorizes the captured operator/account/generation/binding before the source call",async()=>{
    rpc.mockResolvedValue({data:binding,error:null});mockedRead.mockResolvedValue(source);
    const response=await POST(req({accountId:A,contextGeneration:0,bindingId:B},{origin:"https://unc.test"}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({accountId:A,bindingId:B,sourceRowCount:86});
    expect(rpc).toHaveBeenCalledWith("authorize_ops_account_source_read",{p_user_id:U,p_account_id:A,p_context_generation:0,p_binding_id:B});
    expect(mockedRead).toHaveBeenCalledWith(expect.objectContaining({accountId:A,sourceKey:"h1",limit:1}));
  });
  it("fails closed before source access for missing authority, stale context and cross-origin input",async()=>{
    for(const [code,status] of [["42501",403],["PT409",409]] as const){rpc.mockResolvedValue({data:null,error:{code}});expect((await POST(req({accountId:A,contextGeneration:0,bindingId:B}))).status).toBe(status);}
    expect((await POST(req({accountId:A,contextGeneration:0,bindingId:B},{origin:"https://evil.test"}))).status).toBe(403);
    expect(mockedRead).not.toHaveBeenCalled();
  });
});
