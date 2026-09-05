/* The receivers (verify first → status → events) and the Slack install (state handling,
   token sealed per workspace, the installing user linked). Nothing reaches a network. */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KEYRING, stubFetch, json } from "@/lib/connectors/__tests__/helpers";
import { getChannelSecret } from "../secrets";
import { finishSlackInstall, SLACK_STATE_PLATFORM, startSlackInstall as beginInstall } from "../slackOauth";
import { EMPTY_TWIML, receiveSlack, receiveTelegram, receiveTwilio, receiveWhatsApp, receiveWhatsAppVerify, toResponse } from "../webhooks";
import { verifiedLinks, upsertVerifiedLink } from "../links";
import { ACCT, channelDb as baseDb, clock, fakeAdapters, T0, USER } from "./helpers";
import type { Row } from "@/lib/db/types";
import { slackExchangeCode } from "../adapters/slack";

// Application orchestration fixtures only. Exact authority/transaction semantics
// are exercised independently by verify-slack-routed-pipeline.mjs on PostgreSQL.
function channelDb() {
  const db=baseDb();let pin:{state:string;context:Row}|null=null;
  db.rpcs.begin_slack_install=async ({input})=>{
    const i=input as Row;
    const context={protocol:"slack_install_v1",accountId:i.accountId,actorId:i.actorId,contextGeneration:0,issuedAt:db.now()};
    pin={state:String(i.state),context};
    await db.from("oauth_states").insert({state:i.state,account_id:i.accountId,platform:SLACK_STATE_PLATFORM,code_verifier:null,shop:null,
      redirect_to:i.redirectTo,created_at:db.now(),expires_at:new Date(new Date(db.now()).getTime()+600000).toISOString(),auth_context:context});
  };
  db.rpcs.check_slack_install=({state_value,context_value,actor})=>!!pin&&pin.state===state_value&&pin.context.actorId===actor&&JSON.stringify(pin.context)===JSON.stringify(context_value);
  db.rpcs.finish_slack_install=async(args)=>{
    if(!db.rpcs.check_slack_install(args))throw Error("changed authority");
    const i=args.installation as Row,s=args.sealed as Row,c=args.context_value as Row;
    await db.from("channel_secrets").upsert({account_id:c.accountId,channel:"slack",scope_id:i.teamId,ciphertext:s.ciphertext,iv:s.iv,tag:s.tag,key_version:s.keyVersion,updated_at:db.now()},{onConflict:"channel,scope_id"});
    const l=await upsertVerifiedLink(db,{accountId:String(c.accountId),userId:String(args.actor),channel:"slack",externalId:String(i.userId),displayName:String(i.teamName),handle:String(i.teamName),meta:{team_id:i.teamId,team_name:i.teamName,bot_user_id:i.botUserId},now:new Date(db.now())});
    pin=null;return db.rows("channel_links").find(x=>x.id===l.id);
  };return db;
}
function startSlackInstall(deps:Omit<Parameters<typeof beginInstall>[0],"actorId">) {
  (deps.db as ReturnType<typeof channelDb>).now=()=>deps.now.toISOString();
  return beginInstall({...deps,actorId:USER});
}

const ENV = {
  TELEGRAM_BOT_TOKEN: "123:tok",
  TELEGRAM_WEBHOOK_SECRET: "tg-secret",
  TELEGRAM_BOT_USERNAME: "UncBot",
  WHATSAPP_PHONE_NUMBER_ID: "1",
  WHATSAPP_ACCESS_TOKEN: "t",
  WHATSAPP_VERIFY_TOKEN: "wa-verify",
  WHATSAPP_APP_SECRET: "wa-secret",
  SLACK_CLIENT_ID: "cid",
  SLACK_CLIENT_SECRET: "csec",
  SLACK_SIGNING_SECRET: "ssec",
  TWILIO_ACCOUNT_SID: "AC1",
  TWILIO_AUTH_TOKEN: "tw-auth",
  TWILIO_FROM: "+15550001111",
};
const now = () => new Date(T0);
const deps = { env: ENV, now, appUrl: "https://unc.test" };

describe("receivers", () => {
  it("Telegram: 503 unconfigured, 401 bad header (no events), 200 + events on a valid update, 200 on unparseable JSON", () => {
    const update = JSON.stringify({ message: { message_id: 1, chat: { id: 5 }, text: "hi" } });
    expect(receiveTelegram({ ...deps, env: {} }, { secretToken: "x", rawBody: update })).toMatchObject({ status: 503, events: [] });
    expect(receiveTelegram(deps, { secretToken: "wrong", rawBody: update })).toMatchObject({ status: 401, body: { error: "invalid signature" }, events: [] });
    const ok = receiveTelegram(deps, { secretToken: "tg-secret", rawBody: update });
    expect(ok.status).toBe(200);
    expect(ok.events).toEqual([{ channel: "telegram", externalId: "5", externalMsgId: "5:1", text: "hi", handle: undefined, displayName: undefined, at: undefined }]);
    expect(receiveTelegram(deps, { secretToken: "tg-secret", rawBody: "{nope" })).toMatchObject({ status: 200, events: [] });
  });

  it("WhatsApp: the GET handshake (200 challenge / 403) and the signed POST", async () => {
    const v = receiveWhatsAppVerify(deps, new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wa-verify", "hub.challenge": "c123" }));
    expect(v).toMatchObject({ status: 200, body: "c123", contentType: "text/plain" });
    const res = toResponse(v);
    expect(await res.text()).toBe("c123");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(receiveWhatsAppVerify(deps, new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "no", "hub.challenge": "c" })).status).toBe(403);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "6421", id: "wamid.1", type: "text", text: { body: "hi" } }] } }] }] });
    const sig = `sha256=${createHmac("sha256", "wa-secret").update(body).digest("hex")}`;
    expect(receiveWhatsApp(deps, { signature: sig, rawBody: body }).events).toHaveLength(1);
    expect(receiveWhatsApp(deps, { signature: sig, rawBody: body + " " })).toMatchObject({ status: 401, events: [] });
    expect(receiveWhatsApp({ ...deps, env: {} }, { signature: sig, rawBody: body }).status).toBe(503);
  });

  it("Slack: challenge answered after verification; events on a signed DM; a replayed timestamp is 401", () => {
    const ts = String(Math.floor(now().getTime() / 1000) - 5);
    const challenge = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const sign = (t: string, b: string) => `v0=${createHmac("sha256", "ssec").update(`v0:${t}:${b}`).digest("hex")}`;
    expect(receiveSlack(deps, { signature: sign(ts, challenge), timestamp: ts, contentType: "application/json", rawBody: challenge })).toMatchObject({ status: 200, body: { challenge: "abc" }, events: [] });
    expect(receiveSlack(deps, { signature: "v0=bad", timestamp: ts, contentType: "application/json", rawBody: challenge }).status).toBe(401);
    const dm = JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", ts: "1.1", text: "hi" } });
    expect(receiveSlack(deps, { signature: sign(ts, dm), timestamp: ts, contentType: "application/json", rawBody: dm }).events).toMatchObject([{ externalId: "U1", text: "hi", scopeId: "T1" }]);
    const old = String(Math.floor(now().getTime() / 1000) - 600);
    expect(receiveSlack(deps, { signature: sign(old, dm), timestamp: old, contentType: "application/json", rawBody: dm }).status).toBe(401);
  });

  it("Twilio: signed over APP_URL + path + form fields; answers empty TwiML", async () => {
    const params = { From: "+6421", Body: "hold", MessageSid: "SM1" };
    const raw = new URLSearchParams(params).toString();
    const sig = createHmac("sha1", "tw-auth").update("https://unc.test/api/webhooks/twilio" + "Body" + "hold" + "From" + "+6421" + "MessageSid" + "SM1").digest("base64");
    const r = receiveTwilio(deps, { signature: sig, rawBody: raw });
    expect(r).toMatchObject({ status: 200, body: EMPTY_TWIML, contentType: "text/xml" });
    expect(r.events).toEqual([{ channel: "sms", externalId: "+6421", externalMsgId: "SM1", text: "hold", handle: "+6421" }]);
    expect((await toResponse(r).text()).startsWith("<?xml")).toBe(true);
    expect(receiveTwilio({ ...deps, appUrl: "https://other.test" }, { signature: sig, rawBody: raw }).status).toBe(401);
    expect(receiveTwilio(deps, { signature: null, rawBody: raw }).status).toBe(401);
  });
});

describe("Slack install", () => {
  const config = { clientId: "cid", clientSecret: "csec", signingSecret: "ssec" };

  it.each(["superseded", "different_actor"])("refuses %s consent before exchanging a code", async (mode) => {
    const db = channelDb();
    const f = stubFetch();
    const input = { db, config, appUrl: "https://unc.test", accountId: ACCT, now: now() };
    const { state } = await startSlackInstall(input);
    if (mode === "superseded") await startSlackInstall(input);
    const result = await finishSlackInstall({ ...input, keyring: KEYRING, fetch: f.fetch, userId: mode === "different_actor" ? "another-owner" : USER }, new URLSearchParams({ state, code: "synthetic-code" }));
    expect(result).toMatchObject({ ok: false, reason: "session_mismatch" });
    expect(f.calls).toHaveLength(0);
    expect(db.rows("channel_secrets")).toHaveLength(0);
  });

  it("does not retry the provider or claim success after a committed install loses its response", async () => {
    const db = channelDb();
    const finish = db.rpcs.finish_slack_install;
    db.rpcs.finish_slack_install = async (args) => { await finish(args); throw Error("synthetic response loss"); };
    const f = stubFetch([() => json({ ok: true, access_token: "synthetic-bot", team: { id: "T1" }, authed_user: { id: "U1" }, bot_user_id: "UB" })]);
    const input = { db, config, appUrl: "https://unc.test", accountId: ACCT, now: now() };
    const { state } = await startSlackInstall(input);
    const deps = { ...input, keyring: KEYRING, fetch: f.fetch, userId: USER };
    const query = new URLSearchParams({ state, code: "synthetic-code" });
    expect(await finishSlackInstall(deps, query)).toMatchObject({ ok: false, reason: "save_unconfirmed" });
    expect(db.rows("channel_secrets")).toHaveLength(1);
    expect(await finishSlackInstall(deps, query)).toMatchObject({ ok: false, reason: "bad_state" });
    expect(f.calls).toHaveLength(1);
  });

  it("bounds code exchange and refuses malformed provider identities before storage", async () => {
    const valid = { ok: true, access_token: "synthetic-bot", team: { id: "T1", name: "Example" }, authed_user: { id: "U1" }, bot_user_id: "UB" };
    for (const response of [null, { ...valid, ok: "true" }, { ...valid, access_token: 42 }, { ...valid, bot_user_id: null }, { ...valid, team: { id: "C1" } }, { ...valid, authed_user: { id: "T1" } }]) {
      expect(await slackExchangeCode(async () => json(response), config, "synthetic-code", "https://unc.test/callback")).toBeNull();
    }
    const result = await slackExchangeCode(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return json(valid);
    }, config, "synthetic-code", "https://unc.test/callback");
    expect(result).toMatchObject({ teamId: "T1", userId: "U1", botUserId: "UB" });
  });

  it("start writes a single-use state under the channel platform and points at Slack with the callback", async () => {
    const db = channelDb();
    const { url, state } = await startSlackInstall({ db, config, appUrl: "https://unc.test/", accountId: ACCT, now: now(), redirectTo: "/app?view=channels" });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe("https://unc.test/api/channels/slack/callback");
    expect(u.searchParams.get("state")).toBe(state);
    expect(db.rows("oauth_states")[0]).toMatchObject({ state, account_id: ACCT, platform: SLACK_STATE_PLATFORM, redirect_to: "/app?view=channels" });
    // open redirects are not followed
    const { state: s2 } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: now(), redirectTo: "//evil.test" });
    expect(db.rows("oauth_states").find((r) => r.state === s2)?.redirect_to).toBe("/app");
  });

  it("concurrent Slack callbacks exchange and link only once", async () => {
    const db = channelDb();
    const f = stubFetch([() => json({ ok: true, access_token: "synthetic-bot", team: { id: "T1", name: "Example" }, authed_user: { id: "U1" }, bot_user_id: "UB" })]);
    const { state } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: now() });
    const base = { db, keyring: KEYRING, config, fetch: f.fetch, appUrl: "https://unc.test", now: now(), userId: USER };
    const query = new URLSearchParams({ code: "synthetic-code", state });
    const results = await Promise.all([finishSlackInstall(base, query), finishSlackInstall(base, query)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(db.rows("channel_secrets")).toHaveLength(1);
    expect(db.rows("channel_links")).toHaveLength(1);
  });

  it.each(["boundary", "invalid"])("rejects Slack expiry %s before provider work", async (mode) => {
    const db = channelDb();
    const f = stubFetch();
    const { state } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: now() });
    db.rows("oauth_states")[0].expires_at = mode === "boundary" ? now().toISOString() : "invalid";
    const result = await finishSlackInstall({ db, keyring: KEYRING, config, fetch: f.fetch, appUrl: "https://unc.test", now: now(), userId: USER }, new URLSearchParams({ code: "synthetic-code", state }));
    expect(result).toMatchObject({ ok: false, reason: "bad_state" });
    expect(f.calls).toHaveLength(0);
  });

  it("finish: bad / reused / expired state; denied; exchange failure; success seals the bot token per team and links the installing user", async () => {
    const db = channelDb();
    const clk = clock();
    const f = stubFetch([(c) => (c.url === "https://slack.com/api/oauth.v2.access" ? json({ ok: true, access_token: "xoxb-workspace-token", team: { id: "T1", name: "Acme" }, authed_user: { id: "U1" }, bot_user_id: "UB" }) : undefined)]);
    const adapters = fakeAdapters();
    const base = { db, keyring: KEYRING, config, fetch: f.fetch, appUrl: "https://unc.test", now: clk.now(), userId: USER, adapters };

    expect(await finishSlackInstall(base, new URLSearchParams({ code: "c", state: "nope" }))).toEqual({ ok: false, reason: "bad_state", redirectTo: "/app" });

    const { state } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app" });
    expect(await finishSlackInstall(base, new URLSearchParams({ error: "access_denied", state }))).toEqual({ ok: false, reason: "denied", redirectTo: "/app" });
    expect(await finishSlackInstall(base, new URLSearchParams({ code: "c", state }))).toMatchObject({ ok: false, reason: "bad_state" }); // single-use

    const { state: s2 } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app" });
    clk.advance(11 * 60 * 1000);
    expect(await finishSlackInstall({ ...base, now: clk.now() }, new URLSearchParams({ code: "c", state: s2 }))).toMatchObject({ ok: false, reason: "bad_state" });

    const { state: s3 } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app" });
    expect(await finishSlackInstall({ ...base, keyring: null }, new URLSearchParams({ code: "c", state: s3 }))).toMatchObject({ ok: false, reason: "no_keyring" });

    const { state: unauthorisedState } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app" });
    expect(await finishSlackInstall({ ...base, userId: null }, new URLSearchParams({ code: "c", state: unauthorisedState }))).toMatchObject({ ok: false, reason: "session_mismatch" });
    expect(f.calls).toHaveLength(0);

    const { state: s4 } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app" });
    const bad = stubFetch([() => json({ ok: false, error: "invalid_code" })]);
    expect(await finishSlackInstall({ ...base, fetch: bad.fetch }, new URLSearchParams({ code: "c", state: s4 }))).toMatchObject({ ok: false, reason: "exchange_failed" });

    const { state: s5 } = await startSlackInstall({ db, config, appUrl: "https://unc.test", accountId: ACCT, now: clk.now(), redirectTo: "/app?view=channels" });
    const r = await finishSlackInstall(base, new URLSearchParams({ code: "good", state: s5 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.redirectTo).toBe("/app?view=channels");
    expect(r.link).toMatchObject({ accountId: ACCT, userId: USER, channel: "slack", externalId: "U1", displayName: "Acme", meta: { team_id: "T1", team_name: "Acme", bot_user_id: "UB" } });
    const exchange = new URLSearchParams(f.calls[0].body!);
    expect(exchange.get("redirect_uri")).toBe("https://unc.test/api/channels/slack/callback");
    expect(exchange.get("client_secret")).toBe("csec");
    // sealed at rest, opens only with the keyring + the right team
    const row = db.rows("channel_secrets")[0];
    expect(row).toMatchObject({ account_id: ACCT, channel: "slack", scope_id: "T1", key_version: 1 });
    expect(JSON.stringify(row)).not.toContain("xoxb-workspace-token");
    expect((await getChannelSecret(db, KEYRING, "slack", "T1"))?.accessToken).toBe("xoxb-workspace-token");
    await expect(getChannelSecret(db, KEYRING, "slack", "T2")).resolves.toBeNull();
    expect((await verifiedLinks(db, ACCT)).map((l) => l.channel)).toEqual(["slack"]);
    // Installing a connection is not permission to send an unsolicited welcome.
    expect(adapters.slack.sent).toHaveLength(0);
  });
});
