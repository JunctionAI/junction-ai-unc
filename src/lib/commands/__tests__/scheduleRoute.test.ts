import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
const session=vi.hoisted(()=>({current:null as unknown}));
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session.current}));
import { GET,POST } from "../../../app/api/routines/schedule/route";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072",S="139a41a8-a81c-46dc-850f-1a80a4b9c37a";
function setup(){const db=new FakeSupabase();db.seed("accounts",[{id:A,context_generation:1,automation_paused:false}]);
 db.seed("routine_schedules",[{id:S,account_id:A,context_generation:1,user_id:U,routine_id:"D03-W01",revision:0,enabled:true,timezone:"UTC",hour:9,minute:0,weekday:null,on_date:null,channel:"app"}]);
 session.current={accountId:A,userId:U,service:db};return db;}
const headers={"content-type":"application/json","x-unc-account-id":A,"x-unc-context-generation":"1"};
const body={routineId:"D03-W01",revision:0,enabled:false,timezone:"UTC",hour:9,minute:0,weekday:null,deliveryCommandId:null};
afterEach(()=>vi.unstubAllEnvs());
describe("schedule account API",()=>{
 it("preserves sign-in refusal",async()=>{session.current=new Response(null,{status:401});expect((await GET(new Request("https://unc.test/api/routines/schedule?routineId=D03-W01"))).status).toBe(401);});
 it("requires captured account context",async()=>{setup();expect((await GET(new Request("https://unc.test/api/routines/schedule?routineId=D03-W01"))).status).toBe(409);});
 it("reads only this account and generation without binding or secrets",async()=>{setup();const r=await GET(new Request("https://unc.test/api/routines/schedule?routineId=D03-W01",{headers}));expect(r.status).toBe(200);const b=await r.json();expect(b.schedule.id).toBe(S);expect(b.schedule.channel_binding).toBeUndefined();expect(b.schedule.user_id).toBeUndefined();});
 it("allows stop even when scheduling release is off",async()=>{const db=setup();vi.stubEnv("UNC_ROUTINE_SCHEDULES_ENABLED","false");const r=await POST(new Request("https://unc.test/api/routines/schedule",{method:"POST",headers,body:JSON.stringify(body)}));expect(r.status).toBe(200);expect(db.rows("routine_schedules")[0].enabled).toBe(false);});
 it("refuses a stale editor revision",async()=>{const db=setup();const r=await POST(new Request("https://unc.test/api/routines/schedule",{method:"POST",headers,body:JSON.stringify({...body,revision:2})}));expect(r.status).toBe(409);expect(db.rows("routine_schedules")[0].enabled).toBe(true);});
 it("cannot activate without release",async()=>{setup();vi.stubEnv("UNC_ROUTINE_SCHEDULES_ENABLED","false");const r=await POST(new Request("https://unc.test/api/routines/schedule",{method:"POST",headers,body:JSON.stringify({...body,enabled:true})}));expect(r.status).toBe(409);});
});
