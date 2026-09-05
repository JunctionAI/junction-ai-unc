import { afterEach, describe, expect, it, vi } from "vitest";
import { SlackAdapter, parseSlackEvent } from "../adapters/slack";
import { rowToLink, listLinks, findVerifiedLink, upsertVerifiedLink } from "../links";
import { pushToAccount, sendOnLink } from "../outbound";
import { handleInbound } from "../inbound";
import { historyFor } from "../thread";
import { commandChannelBinding } from "../../commands/binding";
import { DbCommandQueue, commandId } from "../../commands/queue";
import type { CommandActor, RoutineCommand } from "../../commands/types";
import { MemoryStore } from "../../runtime/store/memory";
import { StaticAccountsSource } from "@/worker/accounts";
import { ACCT, OTHER, USER, T0, channelDb, seedLink, fakeAdapters } from "./helpers";
import type { CapturedInbound } from "../binding";

const routeId = "44444444-4444-4444-8444-444444444444";
const origin = { workspaceId: "T1", conversationId: "C1", threadId: "1756800000.000099" };
function setup() {
  const db = channelDb();
  const link = seedLink(db, { channel: "slack", external_id: "U1", slack_route_id: routeId,
    meta: { team_id: "T1", bot_user_id: "UBOT", slack_conversation_id: "C1", slack_route_id: routeId } });
  const adapters = fakeAdapters();
  return { db, link, adapters, deps: { db, adapters, now: () => new Date(T0) } };
}
afterEach(() => vi.unstubAllEnvs());

describe("routed Slack application pipeline (SQL identity separately proven)", () => {
  it("returns a captured room message to its original thread without feeding other conversations to the model", async () => {
    vi.stubEnv("UNC_MESSAGING_ENABLED", "true");vi.stubEnv("UNC_COMMANDS_ENABLED", "false");
    const f = setup();
    const parsed = parseSlackEvent({ type: "event_callback", team_id: "T1", event: { type: "app_mention", user: "U1", channel: "C1",
      ts: "1756800001.000001", thread_ts: origin.threadId, text: "<@UBOT> hello" } });
    if (parsed.kind !== "events") throw Error("expected event");
    const captured: CapturedInbound = { id: "a".repeat(64), event: parsed.events[0], binding: { version: 1, kind: "linked", accountId: ACCT,
      contextGeneration: 0, userId: USER, linkId: f.link.id, bindingVersion: 0 } };
    f.db.insertRow("channel_inbox", { ...captured, channel: "slack", status: "running" });
    f.db.seed("chat_messages", [
      { account_id: ACCT, sender: "user", channel: "app", body: "private app chat", thread: "corner", position: 0, meta: {} },
      { account_id: ACCT, sender: "user", channel: "slack", body: "another room", thread: "corner", position: 1,
        meta: { slack_origin: { ...origin, conversationId: "C2" } } },
      { account_id: ACCT, sender: "user", channel: "slack", body: "another thread", thread: "corner", position: 2,
        meta: { slack_origin: { ...origin, threadId: "1756800000.000098" } } },
    ]);
    const respond = vi.fn(async () => ({ ok: true as const, reply: "your result" }));
    const result = await handleInbound({ ...f.deps, store: new MemoryStore(), accounts: new StaticAccountsSource(), respond }, captured);
    expect(result.kind).toBe("replied");
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCT, history: [{ role: "user", content: "hello" }] }));
    expect(f.adapters.slack.sent).toHaveLength(1);
    expect(f.adapters.slack.sent[0].opts.slackOrigin).toEqual({ conversationId: "C1", threadId: origin.threadId });
    expect(f.db.rows("outbound_messages")[0].binding).toMatchObject({ accountId: ACCT, conversationId: "C1", threadId: origin.threadId });
  });

  it("does not confuse routed destinations with OAuth identities or proactive recipients", async () => {
    vi.stubEnv("UNC_MESSAGING_ENABLED", "true");
    const f = setup();
    const identity = seedLink(f.db, { channel: "slack", external_id: "U1", meta: { team_id: "T1" } });
    expect((await findVerifiedLink(f.db, "slack", "U1"))?.id).toBe(identity.id);
    expect((await listLinks(f.db, ACCT)).map(l => l.id)).toEqual([identity.id]);
    await upsertVerifiedLink(f.db, { accountId: OTHER, userId: USER, channel: "slack", externalId: "U1", now: new Date(T0) });
    expect(rowToLink(f.db.rows("channel_links").find(l => l.id === f.link.id)!)).toMatchObject({ accountId: ACCT, slackRouteId: routeId });
    const report = await pushToAccount(f.deps, { accountId: ACCT, kind: "brief", ref: "one", payload: { text: "brief" }, links: [f.link], timezone: "UTC" });
    expect(report.skipped).toBe(1);expect(f.adapters.slack.sent).toHaveLength(0);
    await expect(sendOnLink(f.deps, f.link, "reply", { text: "hi" }, { ref: "missing-origin", contextGeneration: 0 })).rejects.toThrow("thread required");
    await expect(sendOnLink({ ...f.deps, replyContext: { live: false, inReplyTo: "original", ...origin } }, f.link, "reply", { text: "hi" },
      { ref: "redirect", replyContext: { live: true, inReplyTo: "original", conversationId: "C1", threadId: "1756800000.000001" } })).rejects.toThrow("Cannot redirect");
  });

  it("reads same-thread replies from the persisted outbox projection without importing another audience", async () => {
    const f = setup();
    f.db.seed("chat_messages", [
      { account_id: ACCT, sender: "unc", channel: "slack", body: "same thread result", thread: "corner", position: 0,
        delivery: { slack_origin: origin } },
      { account_id: ACCT, sender: "unc", channel: "slack", body: "other workspace", thread: "corner", position: 1,
        delivery: { slack_origin: { ...origin, workspaceId: "T2" } } },
    ]);
    expect(await historyFor(f.db, ACCT, 24, 0, origin)).toEqual([{ role: "assistant", content: "same thread result" }]);
  });

  it("round-trips command origin through the durable queue and includes it in command identity", async () => {
    const f = setup();
    const actor: CommandActor = { accountId: ACCT, contextGeneration: 0, userId: USER, channel: "slack", linkId: f.link.id,
      requestId: "C1:1756800001.000001", channelBinding: { bindingVersion: 0, externalId: "U1", scopeId: "T1", conversationId: "C1", threadId: origin.threadId } };
    const command: RoutineCommand = { id: commandId(actor), actor, contextGeneration: 0, notificationRevision: 0, requestHash: "test", routineId: "D03-W01",
      specHash: "test", workflowHash: "test", version: 1, request: "keyword", status: "queued", reply: "queued", runId: null, createdAt: T0, updatedAt: T0 };
    const queue = new DbCommandQueue(f.db);
    expect((await queue.enqueue(command)).actor.channelBinding).toEqual(actor.channelBinding);
    expect(commandChannelBinding(actor)).toMatchObject({ conversationId: "C1", threadId: origin.threadId });
    expect(commandId({ ...actor, channelBinding: { ...actor.channelBinding!, threadId: "1756800000.000098" } })).not.toBe(command.id);
    expect(() => commandChannelBinding({ ...actor, channelBinding: { ...actor.channelBinding!, threadId: undefined } })).toThrow();
  });
});

describe("routed Slack provider request shape (no network)", () => {
  function adapter() {
    const posted = { ok: true, channel: "C1", ts: "1756800002.000001" };
    const fetch = vi.fn(async () => Response.json(posted));
    const tokenFor = vi.fn(async () => "synthetic-token");
    return { posted, fetch, tokenFor, adapter: new SlackAdapter({ clientId: "local", clientSecret: "local", signingSecret: "local" }, fetch, tokenFor) };
  }
  it("posts directly into the bound room/thread, never opens a DM or broadcasts the reply", async () => {
    const f = setup(), a = adapter();
    expect(await a.adapter.send("U1", { text: "result" }, { link: f.link, slackOrigin: origin })).toEqual({ ok: true, externalMsgId: "C1:1756800002.000001" });
    expect(a.fetch).toHaveBeenCalledTimes(1);
    expect(a.fetch).toHaveBeenCalledWith("https://slack.com/api/chat.postMessage", expect.objectContaining({
      body: expect.stringContaining('"thread_ts":"1756800000.000099"'),
    }));
    const init = a.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toMatchObject({ channel: "C1", reply_broadcast: false });
  });
  it("refuses missing/wrong room origins and direct-link room sends before token access", async () => {
    const f = setup(), a = adapter();
    expect((await a.adapter.send("U1", { text: "x" }, { link: f.link })).ok).toBe(false);
    expect((await a.adapter.send("U1", { text: "x" }, { link: f.link, slackOrigin: { ...origin, conversationId: "C2" } })).ok).toBe(false);
    expect((await a.adapter.send("U1", { text: "x" }, { link: { ...f.link, slackRouteId: undefined }, slackOrigin: origin })).ok).toBe(false);
    expect(a.tokenFor).not.toHaveBeenCalled();expect(a.fetch).not.toHaveBeenCalled();
  });
  it("does not claim success for a provider response naming another destination, or bypass the ledger through response_url", async () => {
    const f = setup(), a = adapter();a.posted.channel = "COTHER";
    expect((await a.adapter.send("U1", { text: "x" }, { link: f.link, slackOrigin: origin })).ok).toBe(false);
    a.fetch.mockClear();
    await a.adapter.ack({ channel: "slack", externalId: "U1", externalMsgId: "press", conversationId: "C1", ackRef: "https://hooks.slack.com/actions/synthetic" }, "approved");
    expect(a.fetch).not.toHaveBeenCalled();
  });
});
