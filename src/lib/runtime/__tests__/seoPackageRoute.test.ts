import { afterEach,expect,it,vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
const session=vi.hoisted(()=>({value:null as unknown}));
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session.value}));
import {GET,POST} from "../../../app/api/seo/packages/route";
const headers={"content-type":"application/json","x-unc-account-id":"a","x-unc-context-generation":"1"};
function setup(){const db=new FakeSupabase();db.seed("accounts",[{id:"a",context_generation:1,automation_paused:false}]);
 db.seed("seo_package_settings",[{account_id:"a",context_generation:1,enabled:true,prepare_articles:true,prepare_page_edits:true}]);
 db.seed("seo_work_packages",[{id:"p",account_id:"a",context_generation:1,status:"ready",result:{}},{id:"foreign",account_id:"b",context_generation:1},{id:"old",account_id:"a",context_generation:0}]);session.value={accountId:"a",userId:"owner",service:db};return db;}
afterEach(()=>vi.unstubAllEnvs());
it("requires authentication",async()=>{session.value=new Response(null,{status:401});expect((await GET(new Request("https://example.com"))).status).toBe(401);});
it("requires captured generation",async()=>{setup();expect((await GET(new Request("https://example.com"))).status).toBe(409);});
it("reads only current account packages",async()=>{setup();const r=await GET(new Request("https://example.com",{headers}));expect(r.status).toBe(200);expect((await r.json()).packages.map((p:{id:string})=>p.id)).toEqual(["p"]);});
it("rejects unsolicited result writes",async()=>{setup();const r=await POST(new Request("https://example.com",{method:"POST",headers,body:JSON.stringify({operation:"settings",enabled:true,prepareArticles:true,preparePageEdits:true,result:{}})}));expect(r.status).toBe(400);});
it("cannot start when rollout is disabled",async()=>{setup();vi.stubEnv("UNC_SEO_PACKAGES_ENABLED","false");const r=await POST(new Request("https://example.com",{method:"POST",headers,body:JSON.stringify({operation:"settings",enabled:true,prepareArticles:true,preparePageEdits:true})}));expect(r.status).toBe(409);});
it("can stop when rollout is disabled",async()=>{const db=setup();vi.stubEnv("UNC_SEO_PACKAGES_ENABLED","false");const r=await POST(new Request("https://example.com",{method:"POST",headers,body:JSON.stringify({operation:"settings",enabled:false,prepareArticles:true,preparePageEdits:true})}));expect(r.status).toBe(200);expect(db.rows("seo_package_settings")[0].enabled).toBe(false);});
