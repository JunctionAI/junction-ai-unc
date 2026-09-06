import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db/types";
import type { OpsIdentity } from "../session";
import { parseSourceBindings } from "../sourceBindings";

const USER="00000000-0000-4000-8000-000000000001", ACCOUNT="00000000-0000-4000-8000-000000000002", ID="00000000-0000-4000-8000-000000000003";
const binding={id:ID,accountId:ACCOUNT,sourceSystem:"mission_control",sourceProject:"project-one",sourceKind:"public.client_accounts",sourceKey:"source-1",displayName:"Client",status:"verified",evidenceRef:"Verified fixture evidence",revision:0,verifiedAt:"2026-09-06T00:00:00Z",verifiedBy:USER};
const rpc=vi.fn();let operator:OpsIdentity|Response;
vi.mock("../session",()=>({requireOpsIdentity:async()=>operator}));
import { GET,POST } from "@/app/api/ops/sources/route";
const request=(method:"GET"|"POST",body?:unknown,headers:Record<string,string>={})=>new Request(method==="GET"?`https://unc.test/api/ops/sources?accountId=${ACCOUNT}`:"https://unc.test/api/ops/sources",{method,headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
const write={accountId:ACCOUNT,contextGeneration:1,sourceSystem:"mission_control",sourceProject:"project-one",sourceKind:"public.client_accounts",sourceKey:"source-1",displayName:"Client",status:"verified",evidenceRef:"Verified fixture evidence",expectedRevision:null};

beforeEach(()=>{rpc.mockReset();operator={userId:USER,service:{rpc} as unknown as DbClient};});

describe("operator source bindings",()=>{
  it("reads only the exact selected client and rejects malformed projections",async()=>{
    rpc.mockResolvedValue({data:[binding],error:null});
    const response=await GET(request("GET"));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledWith("read_ops_account_source_bindings",{p_user_id:USER,p_account_id:ACCOUNT});
    rpc.mockResolvedValue({data:[{...binding,accountId:"00000000-0000-4000-8000-000000000009"}],error:null});
    expect((await GET(request("GET"))).status).toBe(503);
  });
  it("rejects missing, duplicate, malformed and unexpected selectors before database access",async()=>{
    for(const url of ["https://unc.test/api/ops/sources","https://unc.test/api/ops/sources?accountId=bad",`https://unc.test/api/ops/sources?accountId=${ACCOUNT}&accountId=${ACCOUNT}`,`https://unc.test/api/ops/sources?accountId=${ACCOUNT}&role=owner`])
      expect((await GET(new Request(url))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("writes with the server actor, exact generation and compare-and-swap revision",async()=>{
    rpc.mockResolvedValue({data:binding,error:null});
    const response=await POST(request("POST",write,{origin:"https://unc.test"}));expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("upsert_ops_account_source_binding",expect.objectContaining({p_user_id:USER,p_account_id:ACCOUNT,p_context_generation:1,p_expected_revision:null}));
  });
  it("requires same-origin JSON and strict bounded source input",async()=>{
    expect((await POST(request("POST",write,{origin:"https://evil.test"}))).status).toBe(403);
    expect((await POST(request("POST",write,{"content-type":"text/plain"}))).status).toBe(415);
    expect((await POST(request("POST",{...write,unexpected:true}))).status).toBe(400);
    expect((await POST(request("POST",{...write,sourceKey:"has space"}))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps authority and identity races without exposing database details",async()=>{
    for(const [code,status] of [["42501",403],["PT409",409],["40001",409],["23505",409],["XX000",503]] as const){
      rpc.mockResolvedValue({data:null,error:{code,message:"private"}});const response=await POST(request("POST",write));
      expect(response.status).toBe(status);expect(await response.text()).not.toContain("private");
    }
  });
  it("refuses unsigned operators before reads or writes",async()=>{
    operator=new Response(null,{status:401});expect((await GET(request("GET"))).status).toBe(401);expect((await POST(request("POST",write))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();
  });
});

describe("source binding projection",()=>{
  it("refuses duplicate source identities and IDs",()=>{
    expect(parseSourceBindings([binding,{...binding,id:"00000000-0000-4000-8000-000000000004"}])).toBeNull();
    expect(parseSourceBindings([binding,{...binding,sourceKey:"source-2"}])).toBeNull();
  });
});
