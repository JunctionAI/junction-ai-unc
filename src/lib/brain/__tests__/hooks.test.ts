/* The learning hooks: chat (debounce + rolling summaries), scan, self-review, approval
   (memory + decision-style refresh), onboarding — and the no-database no-op. */

import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalRecord, TasteEvent } from "@/lib/runtime/types";
import { listMemories } from "../memory";
import { getProfile } from "../profile";
import { afterApprovalDecision, afterChatReply, afterOnboarding, afterScan, afterSelfReview, CHAT_EXTRACT_MIN_CHARS, deterministicSummary, fnv1a, rollingSummaries, setBrainDbForTests, summaryBlocks } from "../hooks";
import { ACCT, brainDb, clock, scriptedLlm } from "./helpers";

afterEach(() => setBrainDbForTests(undefined));

const LONG = "We never discount below 15% because our margin is only 42% and the wholesale channel would notice.";

const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i} ${i % 2 ? "unc says something" : "founder says something"}` }));

describe("afterChatReply", () => {
  it("no database → no-op, nothing written, nothing thrown", async () => {
    setBrainDbForTests(() => null);
    const r = await afterChatReply({ accountId: ACCT, surface: "corner", history: [{ role: "user", content: LONG }], reply: "Noted." });
    expect(r).toEqual({ extracted: null, skipped: "no_db", summariesWritten: 0 });
  });

  it("skips extraction when the founder's message is under 40 chars; runs it (last 2 turns + reply) otherwise", async () => {
    const db = brainDb();
    const llm = scriptedLlm({ memories: [{ kind: "constraint", text: "Never discounts below 15%.", importance: 5 }] });
    const short = await afterChatReply({ accountId: ACCT, surface: "corner", history: [{ role: "user", content: "why?" }], reply: "Because ROAS." }, { db, llm, embed: null });
    expect(short.skipped).toBe("short_message");
    expect(llm.prompts).toHaveLength(0);
    expect("x".repeat(CHAT_EXTRACT_MIN_CHARS - 1).length).toBeLessThan(CHAT_EXTRACT_MIN_CHARS);

    const history = [{ role: "user" as const, content: "Old question about shipping rates in the US." }, { role: "assistant" as const, content: "I'd suggest a 25% welcome offer." }, { role: "user" as const, content: LONG }];
    const r = await afterChatReply({ accountId: ACCT, surface: "corner", history, reply: "Noted — no discounts below 15%." }, { db, llm, embed: null, now: clock().now });
    expect(r.skipped).toBeUndefined();
    expect(r.extracted?.accepted.map((m) => m.text)).toEqual(["Never discounts below 15%."]);
    expect(r.extracted?.accepted[0].sourceRef).toBe("chat:corner:2026-09-02");
    const material = llm.prompts[0].user;
    expect(material).toContain("UNC (assistant): I'd suggest a 25% welcome offer.");
    expect(material).toContain(`FOUNDER: ${LONG}`);
    expect(material).toContain("UNC (assistant): Noted — no discounts below 15%.");
    expect(material).not.toContain("Old question about shipping"); // only the last two turns + the reply
    expect(r.summariesWritten).toBe(0);
  });

  it("a model failure never breaks the hook", async () => {
    const db = brainDb();
    const logs: string[] = [];
    const r = await afterChatReply({ accountId: ACCT, surface: "corner", history: [{ role: "user", content: LONG }], reply: "ok" }, { db, llm: { complete: async () => Promise.reject(new Error("boom")) }, embed: null, log: (e) => logs.push(e) });
    expect(r.extracted?.author).toBe("none");
    expect(logs).toContain("brain.extract_llm_failed");
  });
});

describe("rolling summaries", () => {
  it("summaryBlocks: nothing at 24 turns; block 0 at 25; block 1 from 37; a stable key per block", () => {
    expect(summaryBlocks(turns(24))).toEqual([]);
    expect(summaryBlocks(turns(25)).map((b) => b.index)).toEqual([0]);
    expect(summaryBlocks(turns(36)).map((b) => b.index)).toEqual([0]);
    expect(summaryBlocks(turns(37)).map((b) => b.index)).toEqual([0, 1]);
    expect(summaryBlocks(turns(49)).map((b) => b.index)).toEqual([0, 1, 2]);
    expect(summaryBlocks(turns(37))[1].turns[0].content).toBe("turn 12 founder says something");
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("writes one 'summary' memory per block (model text when traceable, else the founder's own words) and never twice", async () => {
    const db = brainDb();
    const clk = clock();
    const thread = turns(25);
    const llm = scriptedLlm("The founder said something in each of their turns 0 through 10.");
    expect(await rollingSummaries(db, ACCT, "corner", thread, { llm, embed: null, now: clk.now })).toBe(1);
    const [m] = await listMemories(db, ACCT, { kinds: ["summary"] });
    expect(m.text).toBe("The founder said something in each of their turns 0 through 10.");
    expect(m.sourceRef).toMatch(/^chat:corner:summary:0:[0-9a-f]{8}$/);
    expect(m.source).toBe("chat");
    expect(m.tags).toEqual(["chat", "corner"]);
    expect(await rollingSummaries(db, ACCT, "corner", thread, { llm, embed: null, now: clk.now })).toBe(0); // same block → skipped
    expect(llm.prompts).toHaveLength(1);
    // the thread grows past 36: block 1 gets its own summary
    expect(await rollingSummaries(db, ACCT, "corner", turns(37), { llm, embed: null, now: clk.now })).toBe(1);
    expect(await listMemories(db, ACCT, { kinds: ["summary"] })).toHaveLength(2);
  });

  it("an untraceable or missing model summary falls back to the founder's own turns", async () => {
    const db = brainDb();
    const invented = scriptedLlm("The founder wants to open a store in Paris and hire twelve people.");
    await rollingSummaries(db, ACCT, "corner", turns(25), { llm: invented, embed: null });
    const [m] = await listMemories(db, ACCT, { kinds: ["summary"] });
    expect(m.text.startsWith("Earlier in this thread the founder said: turn 0 founder says something · turn 2 founder says something")).toBe(true);
    const db2 = brainDb();
    await rollingSummaries(db2, ACCT, "onboarding", turns(25), { llm: null, embed: null });
    expect((await listMemories(db2, ACCT, { kinds: ["summary"] }))[0].tags).toEqual(["chat", "onboarding"]);
    expect(deterministicSummary([{ role: "assistant", content: "only unc" }])).toBe("");
  });

  it("afterChatReply runs the summaries on the whole thread plus the reply", async () => {
    const db = brainDb();
    const history = turns(24); // 24 in history + the reply = 25
    history[23] = { role: "user", content: LONG };
    const r = await afterChatReply({ accountId: ACCT, surface: "corner", history, reply: "Noted." }, { db, llm: null, embed: null });
    expect(r.summariesWritten).toBe(1);
  });
});

describe("afterScan / afterSelfReview / afterApprovalDecision / afterOnboarding", () => {
  it("scan facts land with source scan and the site as source_ref", async () => {
    const db = brainDb();
    const r = await afterScan({ accountId: ACCT, profile: { name: "Example Co", oneLiner: "Sells examples", confidence: "high", sources: ["https://example.com"] } }, { db, embed: null });
    expect(r?.accepted.map((m) => [m.kind, m.text, m.source, m.sourceRef])).toEqual([["fact", "Example Co: Sells examples", "scan", "https://example.com"]]);
    expect(await afterScan({ accountId: ACCT, profile: {} }, { db: null })).toBeNull();
  });

  it("self-review lessons carry the review id", async () => {
    const db = brainDb();
    const r = await afterSelfReview({ id: "rv1", accountId: ACCT, weekStart: "2026-08-31", body: "What worked: …", changes: [{ action: "disable", routineId: "D03-W02", why: "0 views on 4 posts" }] }, { db, llm: null, embed: null });
    expect(r?.accepted.map((m) => [m.kind, m.sourceRef])).toEqual([["lesson", "self_review:rv1"]]);
  });

  it("an approval decision writes the decision memory and refreshes decision_style from the store", async () => {
    const db = brainDb();
    const events: TasteEvent[] = [
      { id: "t1", accountId: ACCT, routineId: "D02-W01", action: "held", context: {}, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "t2", accountId: ACCT, routineId: "D02-W01", action: "approved", context: {}, createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    const approvals: ApprovalRecord[] = [{ id: "ap1", accountId: ACCT, runId: "r1", routineId: "D02-W01", title: "Move NZ$20/day to retargeting", status: "held", expiresAt: "2026-12-31T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", decidedAt: "2026-09-01T02:00:00.000Z" }];
    const store = { listTasteEvents: async () => events, listApprovals: async (_a: string, s?: ApprovalRecord["status"]) => approvals.filter((x) => x.status === s) };
    const r = await afterApprovalDecision({ id: "ap1", accountId: ACCT, routineId: "D02-W01", title: "Move NZ$20/day to retargeting", detail: "ROAS 3.1" }, "held", { db, store, embed: null });
    expect(r.extracted?.accepted[0]).toMatchObject({ kind: "decision", source: "receipt", sourceRef: "approval:ap1", importance: 4 });
    expect(r.extracted?.accepted[0].text).toMatch(/^Held: "Move NZ\$20\/day to retargeting" \(.+\) — ROAS 3.1$/);
    expect(r.decisionStyle).toMatchObject({ approval_rate: 0.5, median_decision_hours: 2, decisions: 2 });
    expect((await getProfile(db, ACCT))?.decisionStyle).toEqual(r.decisionStyle);
    // deciding the same approval again merges, never duplicates
    await afterApprovalDecision({ id: "ap1", accountId: ACCT, routineId: "D02-W01", title: "Move NZ$20/day to retargeting", detail: "ROAS 3.1" }, "held", { db, embed: null });
    expect(await listMemories(db, ACCT, { kinds: ["decision"] })).toHaveLength(1);
    // demo mode: no db → no-op
    expect(await afterApprovalDecision({ id: "ap1", accountId: ACCT, routineId: "D02-W01", title: "x" }, "approved", { db: null, store })).toEqual({ extracted: null, decisionStyle: null });
  });

  it("onboarding answers become memories once; agreeing again merges", async () => {
    const db = brainDb();
    const answers = { goalTitle: "NZ$40,000 MRR", deadline: "2026-12-31", currency: "NZD", baselineNum: 28400, budgetMo: 1500, hoursWk: 4, strengths: ["Video"], platforms: ["Instagram"], posture: "brand", postureLabel: "Brand-led organic" };
    const first = await afterOnboarding({ accountId: ACCT, answers }, { db, embed: null });
    expect(first).toEqual({ written: 7, merged: 0, failed: 0 });
    const again = await afterOnboarding({ accountId: ACCT, answers }, { db, embed: null });
    expect(again).toEqual({ written: 0, merged: 7, failed: 0 });
    expect((await listMemories(db, ACCT)).every((m) => m.source === "onboarding" && m.sourceRef === `onboarding:${ACCT}`)).toBe(true);
    expect(await afterOnboarding({ accountId: ACCT, answers }, { db: null })).toBeNull();
  });
});
