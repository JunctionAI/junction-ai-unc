import { beforeEach, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { AccountSession } from "@/lib/db/session";
import { SupabaseStore } from "../store/supabase";

const A="00000000-0000-4000-8000-000000000001",U="00000000-0000-4000-8000-000000000002";
let db:FakeSupabase,session:AccountSession|Response;
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session}));
vi.mock("@/lib/runtime/store",()=>({getStore:()=>new SupabaseStore(db)}));
import { GET,POST } from "@/app/api/routines/request/route";
const request=(id:string,body?:unknown,account=A,generation="1")=>new Request(`https://unc.test/api/routines/request?requestId=${id}`,{
  method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":account,"x-unc-context-generation":generation},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});
const cancelBody=(id:string)=>({action:"cancel",requestId:id,routineId:"D01-W01",purpose:"run"});
beforeEach(()=>{
  db=new FakeSupabase();db.seed("accounts",[{id:A,name:"Fixture",context_generation:1,automation_paused:true}]);
  db.seed("account_members",[{account_id:A,user_id:U,role:"owner"}]);
  session={accountId:A,userId:U,role:"owner",email:"fixture@example.test",db,service:db};
});
it("GET on an unknown request returns private 404 without claiming or cancelling",async()=>{
  const r=await GET(request(crypto.randomUUID()));expect(r.status).toBe(404);expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(db.rows("manual_routine_cancellations")).toHaveLength(0);expect(db.rows("routine_runs")).toHaveLength(0);
});
it("cancels a missing request while paused and reads back the same confirmed tombstone",async()=>{
  const id=crypto.randomUUID(),r=await POST(request(id,cancelBody(id)));expect(r.status).toBe(200);
  const body=await r.json();expect(body).toEqual({accountId:A,contextGeneration:1,requestId:id,routineId:"D01-W01",purpose:"run",phase:"cancelled",run:null});
  expect(await(await GET(request(id))).json()).toEqual(body);expect(db.rows("routine_runs")).toHaveLength(0);
});
it("rejects wrong account/stale generation and a revoked owner before any cancellation",async()=>{
  const id=crypto.randomUUID();
  for(const [a,g] of [[U,"1"],[A,"0"],[A,""]])expect((await POST(request(id,cancelBody(id),a,g))).status).toBe(409);
  db.rows("account_members")[0].role="member";
  expect((await POST(request(id,cancelBody(id)))).status).toBe(403);expect(db.rows("manual_routine_cancellations")).toHaveLength(0);
});
it("authentication and malformed/oversized request refusals stay non-cacheable",async()=>{
  const id=crypto.randomUUID();
  for(const b of [null,[],{...cancelBody(id),purpose:"publish"},{...cancelBody(id),routineId:"D03-W01"}])expect((await POST(request(id,b))).status).toBe(400);
  expect((await POST(request(id,{...cancelBody(id),extra:"x".repeat(2100)}))).status).toBe(413);
  session=Response.json({error:"sign in"},{status:401});const denied=await POST(request(id,cancelBody(id)));
  expect(denied.status).toBe(401);expect(denied.headers.get("cache-control")).toBe("private, no-store");
});
it("a lost successful cancellation reply is 503, then GET safely recovers the committed identity",async()=>{
  const id=crypto.randomUUID(),cancel=db.rpcs.cancel_manual_routine_request;
  db.rpcs.cancel_manual_routine_request=async p=>{await cancel(p);throw new Error("sensitive transport detail");};
  const r=await POST(request(id,cancelBody(id)));expect(r.status).toBe(503);expect(await r.text()).not.toContain("sensitive");
  expect(await(await GET(request(id))).json()).toMatchObject({requestId:id,phase:"cancelled",run:null});expect(db.rows("routine_runs")).toHaveLength(0);
});
