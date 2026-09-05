import { describe, expect, it, vi } from "vitest";
import { availability, buildAdapters } from "../adapters";
import { receiveSlack, receiveTelegram, receiveTwilio, receiveWhatsApp, receiveWhatsAppVerify } from "../webhooks";
import { receiveTnz } from "../tnzReceiver";
import { slackSignature } from "../adapters/slack";

describe("messaging release gate", () => {
  const env = { UNC_MESSAGING_ENABLED: "false", TELEGRAM_BOT_TOKEN: "fixture", TELEGRAM_WEBHOOK_SECRET: "fixture", TELEGRAM_BOT_USERNAME: "UncBot" };
  const deps = { env, now: () => new Date(), appUrl: "https://unc.test" };
  it("removes all outbound adapters even when credentials exist", () => {
    const fetch = vi.fn();
    expect(buildAdapters({ env, fetch })).toEqual({});
    expect(availability(env)).toHaveLength(6);
    expect(availability(env).every(c => !c.configured && c.setupNote?.includes("disabled"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects ingress without acknowledging or processing a message", () => {
    const results = [
      receiveTelegram(deps, { secretToken: "fixture", rawBody: "{}" }),
      receiveWhatsApp(deps, { signature: null, rawBody: "{}" }),
      receiveWhatsAppVerify(deps, new URLSearchParams()),
      receiveTwilio(deps, { signature: null, rawBody: "" }),
    ];
    for (const result of results) expect(result).toEqual({ status: 503, body: { error: "messaging_disabled" }, events: [] });
  });
  it("allows only a correctly signed Slack setup challenge while messages and adapters remain disabled",()=>{
    const e={...env,SLACK_CLIENT_ID:"id",SLACK_CLIENT_SECRET:"secret",SLACK_SIGNING_SECRET:"sign"};
    const now=new Date(),timestamp=String(Math.floor(now.getTime()/1000));
    const body=JSON.stringify({type:"url_verification",challenge:"fixture-only"});
    const request={signature:slackSignature("sign",timestamp,body),timestamp,contentType:"application/json",rawBody:body};
    expect(receiveSlack({...deps,env:e,now:()=>now},request)).toMatchObject({status:200,body:{challenge:"fixture-only"},events:[]});
    expect(receiveSlack({...deps,env:e,now:()=>now},{...request,signature:"wrong"})).toMatchObject({status:401,events:[]});
    const message=JSON.stringify({type:"event_callback",team_id:"T1",event:{type:"app_mention",channel:"C1",user:"U1",ts:"1.1",text:"hello"}});
    expect(receiveSlack({...deps,env:e,now:()=>now},{...request,rawBody:message,signature:slackSignature("sign",timestamp,message)})).toMatchObject({status:503,body:{error:"messaging_disabled"},events:[]});
    expect(availability(e).find(x=>x.channel==="slack")).toMatchObject({configured:true,setupOnly:true});
    expect(buildAdapters({env:e,fetch:vi.fn()})).toEqual({});
  });
  it("does not enqueue or wake the TNZ worker", async () => {
    const save = vi.fn(), wake = vi.fn();
    const result = await receiveTnz(new Request("https://unc.test", { method: "POST", body: "{}" }), { env, now: new Date(), save, wake });
    expect(result.status).toBe(503);
    expect(save).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
});
