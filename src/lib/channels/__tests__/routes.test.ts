/* The session-bound routes (/api/channels/links, /api/channels/thread) against the fake with
   the session mocked the way the brief-route test does, plus the Telegram webhook route with
   next/server `after` run inline and the inbound processor captured. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { appendInbound } from "../thread";
import { ACCT, seedLink, USER } from "./helpers";
import { installInboxFixture } from "./inboxFixture";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => true,
}));
const processed = vi.hoisted(() => ({ wakes: [] as (() => unknown)[] }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void processed.wakes.push(fn) }));

import { DELETE, GET, PATCH, POST } from "@/app/api/channels/links/route";
import { instructionFor } from "@/lib/channels/instructions";
import { GET as THREAD } from "@/app/api/channels/thread/route";
import { GET as SLACK_START } from "@/app/api/channels/slack/start/route";
import { POST as TELEGRAM } from "@/app/api/webhooks/telegram/route";
import { POST as WHATSAPP } from "@/app/api/webhooks/whatsapp/route";
import { POST as SLACK } from "@/app/api/webhooks/slack/route";
import { POST as TWILIO } from "@/app/api/webhooks/twilio/route";

const CHANNEL_ENV = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_USERNAME", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "APP_URL"] as const;
const req = (method: string, body?: unknown, path = "/api/channels/links") => new Request(`http://unc.test${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  setFakeEnv();
  process.env.TELEGRAM_BOT_TOKEN = "1:t";
  process.env.TELEGRAM_WEBHOOK_SECRET = "tg-secret";
  process.env.TELEGRAM_BOT_USERNAME = "UncBot";
  process.env.TWILIO_ACCOUNT_SID = "AC1";
  process.env.TWILIO_AUTH_TOKEN = "a";
  process.env.TWILIO_FROM = "+15550001111";
  process.env.APP_URL = "https://unc.test";
  db = new FakeSupabase();
  installInboxFixture(db);
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  processed.wakes.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  restoreEnv();
  for (const k of CHANNEL_ENV) delete process.env[k];
});

describe("all supported general webhook routes use durable ingress", () => {
  const channels = ["telegram", "whatsapp", "slack", "twilio"] as const;
  function signed(channel: typeof channels[number]) {
    vi.stubEnv("UNC_COMMANDS_ENABLED", "false"); // Conversation persistence does not depend on routine commands.
    let body: string;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (channel === "telegram") {
      body = JSON.stringify({ message: { message_id: 50, chat: { id: 5 }, text: "hello" } });
      headers["x-telegram-bot-api-secret-token"] = "tg-secret";
    } else if (channel === "whatsapp") {
      for (const [key, value] of Object.entries({ WHATSAPP_PHONE_NUMBER_ID: "phone", WHATSAPP_ACCESS_TOKEN: "fixture", WHATSAPP_VERIFY_TOKEN: "fixture", WHATSAPP_APP_SECRET: "wa-secret" })) vi.stubEnv(key, value);
      body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "6421", id: "wamid.durable", type: "text", text: { body: "hello" } }] } }] }] });
      headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", "wa-secret").update(body).digest("hex")}`;
    } else if (channel === "slack") {
      for (const [key, value] of Object.entries({ SLACK_CLIENT_ID: "fixture", SLACK_CLIENT_SECRET: "fixture", SLACK_SIGNING_SECRET: "slack-secret" })) vi.stubEnv(key, value);
      body = JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", ts: "1.1", text: "hello" } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers["x-slack-request-timestamp"] = timestamp;
      headers["x-slack-signature"] = `v0=${createHmac("sha256", "slack-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    } else {
      const params = { Body: "hello", From: "+6421", MessageSid: "SM-durable" };
      body = new URLSearchParams(params).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers["x-twilio-signature"] = createHmac("sha1", "a").update("https://unc.test/api/webhooks/twilio" + Object.entries(params).map(([k, v]) => k + v).join("")).digest("base64");
    }
    return { request: new Request(`https://unc.test/api/webhooks/${channel}`, { method: "POST", headers, body }), handler: { telegram: TELEGRAM, whatsapp: WHATSAPP, slack: SLACK, twilio: TWILIO }[channel] };
  }
  it.each(channels)("%s saves the captured envelope before success, even with commands off", async channel => {
    const { request, handler } = signed(channel);
    const response = await handler(request);
    expect(response.status).toBe(200);
    expect(db.rows("channel_inbox")).toHaveLength(1);
    expect(db.rows("channel_inbox")[0]).toMatchObject({ status: "queued", binding: { version: 1, kind: "unlinked" } });
    expect(processed.wakes).toHaveLength(1);
    expect(db.rows("chat_messages")).toHaveLength(0);
  });
  it.each(channels)("%s returns 503 without a wake on storage failure", async channel => {
    const { request, handler } = signed(channel);
    db.rpcs.accept_channel_inbound = () => { throw new Error("storage down"); };
    expect((await handler(request)).status).toBe(503);
    expect(processed.wakes).toHaveLength(0);
    expect(db.rows("channel_inbox")).toHaveLength(0);
  });
});

describe("/api/channels/links", () => {
  it("keeps a different business out of the TNZ pilot and does not expose its account ID", async () => {
    const values = { SMS_PROVIDER: "tnz", TNZ_SMS_ENABLED: "true", TNZ_AUTH_TOKEN: "fixture", TNZ_WEBHOOK_AUTHORIZATION: "Basic fixture-webhook-secret-012345", TNZ_SENDER: "unc@example.test", TNZ_FROM: "800123", TNZ_PILOT_PHONE: "+64210000001", TNZ_PILOT_ACCOUNT_ID: "00000000-0000-4000-8000-00000000acc2" };
    try {
      for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v);
      const data = await (await GET()).json();
      expect(data.channels.find((c: { channel: string }) => c.channel === "sms")).toMatchObject({ configured: false, number: null });
      expect(JSON.stringify(data)).not.toContain(values.TNZ_PILOT_ACCOUNT_ID);
      expect((await POST(req("POST", { channel: "sms" }))).status).toBe(403);
      expect(db.rows("channel_links")).toHaveLength(0);
      vi.stubEnv("TNZ_PILOT_ACCOUNT_ID", ACCT);
      const issued = await (await POST(req("POST", { channel: "sms" }))).json();
      expect(issued.instruction.url).toBe(`sms:800123?&body=${issued.code}`);
      expect(db.rows("channel_links")[0].account_id).toBe(ACCT);
    } finally { vi.unstubAllEnvs(); }
  });
  it("demo mode → fallback; no session → 401", async () => {
    clearBillingEnv();
    expect(await (await GET()).json()).toEqual({ fallback: true });
    restoreEnv();
    setFakeEnv();
    user = null;
    expect((await GET()).status).toBe(401);
  });

  it("GET lists links + which channels are on (no tokens); POST issues a code with the deep link; unconfigured → honest fallback", async () => {
    const listing = await (await GET()).json();
    expect(listing.links).toEqual([]);
    expect(listing.channels.map((c: { channel: string; configured: boolean }) => [c.channel, c.configured])).toEqual([
      ["telegram", true],
      ["whatsapp", false],
      ["slack", false],
      ["sms", true],
      ["email", false],
      ["apple", false],
    ]);
    expect(JSON.stringify(listing)).not.toContain("tg-secret");

    const issued = await (await POST(req("POST", { channel: "telegram" }))).json();
    expect(issued.code).toMatch(/^UNC-[A-Z2-9]{6}$/);
    expect(issued.instruction.url).toBe(`https://t.me/UncBot?start=${issued.code}`);
    expect(issued.instruction.text).toContain("@UncBot");
    expect(db.rows("channel_links")[0]).toMatchObject({ account_id: ACCT, user_id: USER, channel: "telegram", link_code: issued.code, verified_at: null });

    const sms = await (await POST(req("POST", { channel: "sms" }))).json();
    expect(sms.instruction.url).toBe(`sms:+15550001111?&body=${sms.code}`);
    expect(await (await POST(req("POST", { channel: "whatsapp" }))).json()).toEqual({ fallback: true, reason: "not_configured", channel: "whatsapp" });
    expect((await POST(req("POST", { channel: "fax" }))).status).toBe(400);

    const after = await (await GET()).json();
    expect(after.links.map((l: { channel: string; verified: boolean }) => [l.channel, l.verified])).toEqual([
      ["telegram", false],
      ["sms", false],
    ]);
    expect(instructionFor("slack", "", listing.channels)).toMatchObject({ url: "/api/channels/slack/start" });
    expect(instructionFor("email", "", listing.channels).text).toContain("Not switched on yet");
  });

  it("PATCH updates prefs (quiet hours validated); DELETE unlinks — both only on this account's links", async () => {
    const mine = seedLink(db, { channel: "telegram", external_id: "555" });
    const theirs = seedLink(db, { account_id: "00000000-0000-4000-8000-00000000acc2", channel: "telegram", external_id: "556" });
    const p = await (await PATCH(req("PATCH", { linkId: mine.id, prefs: { brief: false, quiet_hours: { start: "22:00", end: "07:00" } } }))).json();
    expect(p.link.prefs).toEqual({ brief: false, approvals: true, drafts: true, quiet_hours: { start: "22:00", end: "07:00" } });
    const p2 = await (await PATCH(req("PATCH", { linkId: mine.id, prefs: { quiet_hours: { start: "99:00", end: "07:00" } } }))).json();
    expect(p2.link.prefs.quiet_hours).toBeNull();
    expect(p2.link.prefs.brief).toBe(false);
    expect((await PATCH(req("PATCH", { linkId: theirs.id, prefs: { brief: false } }))).status).toBe(404);
    expect((await PATCH(req("PATCH", { linkId: mine.id }))).status).toBe(400);
    expect((await DELETE(req("DELETE", { linkId: theirs.id }))).status).toBe(404);
    expect(await (await DELETE(req("DELETE", { linkId: mine.id }))).json()).toEqual({ ok: true });
    expect(db.rows("channel_links").map((r) => r.id)).toEqual([theirs.id]);
  });

  it("lets members read channel state but not create, change, or remove account links", async () => {
    const mine = seedLink(db, { channel: "telegram", external_id: "555" });
    db.rows("account_members")[0].role = "member";
    expect((await GET()).status).toBe(200);
    expect((await POST(req("POST", { channel: "telegram" }))).status).toBe(403);
    expect((await PATCH(req("PATCH", { linkId: mine.id, prefs: { brief: false } }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { linkId: mine.id }))).status).toBe(403);
    expect((await SLACK_START(req("GET", undefined, "/api/channels/slack/start"))).status).toBe(403);
    expect(db.rows("channel_links")).toHaveLength(1);
  });
});

describe("/api/channels/thread", () => {
  it("returns the one conversation oldest first, since a timestamp, with the channel on each row", async () => {
    db.seed("chat_messages", [{ account_id: ACCT, thread: "corner", position: 0, lane: "ai", sender: "user", body: "Morning.", channel: "app", created_at: "2026-09-02T08:00:00.000Z" }]);
    await appendInbound(db, { accountId: ACCT, channel: "telegram", text: "what ran?", externalMsgId: "555:1", now: new Date("2026-09-02T08:10:00.000Z") });
    const all = await (await THREAD(req("GET", undefined, "/api/channels/thread"))).json();
    expect(all.messages.map((m: { channel: string; sender: string; body: string }) => [m.channel, m.sender, m.body])).toEqual([
      ["app", "user", "Morning."],
      ["telegram", "user", "what ran?"],
    ]);
    expect(all.messages[1].externalMsgId).toBe("555:1");
    const since = await (await THREAD(req("GET", undefined, "/api/channels/thread?since=2026-09-02T08:05:00.000Z&limit=50"))).json();
    expect(since.messages).toHaveLength(1);
    user = null;
    expect((await THREAD(req("GET", undefined, "/api/channels/thread"))).status).toBe(401);
  });
});

describe("POST /api/webhooks/telegram", () => {
  it("verifies first, persists arrival identity before 200, then schedules only a durable queue wake", async () => {
    const update = JSON.stringify({ message: { message_id: 1, chat: { id: 5 }, text: "hi" } });
    const bad = await TELEGRAM(new Request("http://unc.test/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" }, body: update }));
    expect(bad.status).toBe(401);
    expect(processed.wakes).toEqual([]);
    expect(db.rows("channel_inbox")).toEqual([]);
    const ok = await TELEGRAM(new Request("http://unc.test/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "tg-secret" }, body: update }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(processed.wakes).toHaveLength(1);
    expect(db.rows("channel_inbox")).toMatchObject([{ event: { channel: "telegram", externalId: "5", text: "hi" }, binding: { version: 1, kind: "unlinked" }, status: "queued" }]);
  });
  it("does not acknowledge or schedule work when durable capture fails", async () => {
    db.rpcs.accept_channel_inbound = () => { throw new Error("storage down"); };
    const response = await TELEGRAM(new Request("http://unc.test/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "tg-secret" }, body: JSON.stringify({ message: { message_id: 1, chat: { id: 5 }, text: "hi" } }) }));
    expect(response.status).toBe(503);
    expect(processed.wakes).toHaveLength(0);
    expect(db.rows("channel_inbox")).toHaveLength(0);
  });
});
