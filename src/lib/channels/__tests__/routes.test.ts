/* The session-bound routes (/api/channels/links, /api/channels/thread) against the fake with
   the session mocked the way the brief-route test does, plus the Telegram webhook route with
   next/server `after` run inline and the inbound processor captured. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { appendInbound } from "../thread";
import { ACCT, seedLink, USER } from "./helpers";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => true,
}));
const processed = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/channels/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/server")>()),
  processInbound: async (events: unknown[]) => void processed.events.push(...events),
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/channels/links/route";
import { instructionFor } from "@/lib/channels/instructions";
import { GET as THREAD } from "@/app/api/channels/thread/route";
import { GET as SLACK_START } from "@/app/api/channels/slack/start/route";
import { POST as TELEGRAM } from "@/app/api/webhooks/telegram/route";

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
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  processed.events.length = 0;
});
afterEach(() => {
  restoreEnv();
  for (const k of CHANNEL_ENV) delete process.env[k];
});

describe("/api/channels/links", () => {
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
  it("verifies first (401, nothing processed), then 200 and hands the events to the processor after responding", async () => {
    const update = JSON.stringify({ message: { message_id: 1, chat: { id: 5 }, text: "hi" } });
    const bad = await TELEGRAM(new Request("http://unc.test/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" }, body: update }));
    expect(bad.status).toBe(401);
    expect(processed.events).toEqual([]);
    const ok = await TELEGRAM(new Request("http://unc.test/api/webhooks/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "tg-secret" }, body: update }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(processed.events).toMatchObject([{ channel: "telegram", externalId: "5", text: "hi" }]);
  });
});
