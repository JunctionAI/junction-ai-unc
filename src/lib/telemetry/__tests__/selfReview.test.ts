/* Unc's weekly self-review: evidence gathering on MemoryStore, the validator over
   adversarial model output (invented number → rejected, invented change → rejected,
   missing ask → fallback), the deterministic fallback, and idempotence per week. */

import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../runtime/store/memory";
import type { Receipt } from "../../runtime/types";
import { measureOutcomes } from "../outcomes";
import { StaticReader } from "../../runtime/providers";
import {
  allowedNumbers,
  buildSelfReviewUserMessage,
  composeBody,
  deterministicSelfReview,
  gatherSelfReviewEvidence,
  generateSelfReview,
  parseSelfReview,
  rejectChange,
  SELF_REVIEW_SYSTEM,
  splitBody,
  weekStartUtc,
  type SelfReviewEvidence,
} from "../selfReview";

const ACCT = "acct-1";
const NOW = new Date("2026-09-02T09:00:00.000Z"); // a Wednesday

async function seed(store: MemoryStore) {
  const on = async (id: string) => store.putRoutineState({ accountId: ACCT, routineId: id, enabled: true, version: 1, draftSpec: null, liveSpec: null, updatedAt: NOW.toISOString() });
  await on("D01-W01");
  await on("D05-W01");
  await on("D05-W04"); // on but idle
  const run = async (id: string, routineId: string, status: "done" | "failed", startedAt: string) => store.createRun({ id, accountId: ACCT, routineId, version: 1, mode: "dry_run", status, startedAt, finishedAt: startedAt });
  await run("r1", "D01-W01", "done", "2026-08-31T07:00:00.000Z");
  await run("r2", "D01-W01", "done", "2026-09-01T07:00:00.000Z");
  await run("r3", "D05-W01", "done", "2026-09-01T07:10:00.000Z");
  await run("r4", "D02-W01", "failed", "2026-09-01T07:20:00.000Z");
  await run("r0", "D01-W01", "done", "2026-08-20T07:00:00.000Z"); // outside the 7-day window
  const rc = async (id: string, runId: string, kind: Receipt["kind"], createdAt: string) => store.appendReceipt({ id, accountId: ACCT, runId, kind, description: `${kind} receipt`, payload: {}, createdAt });
  await rc("c1", "r1", "read", "2026-08-31T07:00:01.000Z");
  await rc("c2", "r1", "draft", "2026-08-31T07:00:02.000Z");
  await rc("c3", "r2", "draft", "2026-09-01T07:00:02.000Z");
  await rc("c4", "r3", "draft", "2026-09-01T07:10:02.000Z");
  await rc("c0", "r0", "draft", "2026-08-20T07:00:02.000Z");
  const ap = async (id: string, routineId: string, status: "approved" | "held" | "pending", createdAt: string) =>
    store.createApproval({ id, accountId: ACCT, runId: "r2", routineId, title: "t", status, expiresAt: "2026-09-05T00:00:00.000Z", createdAt, decidedAt: status === "pending" ? undefined : createdAt });
  await ap("a1", "D01-W01", "approved", "2026-09-01T08:00:00.000Z");
  await ap("a2", "D01-W01", "approved", "2026-09-01T08:01:00.000Z");
  await ap("a3", "D05-W01", "held", "2026-09-01T08:02:00.000Z");
  await ap("a4", "D05-W01", "pending", "2026-09-02T08:02:00.000Z");
  await store.appendTasteEvent({ id: "t1", accountId: ACCT, routineId: "D05-W01", action: "why_opened", context: {}, createdAt: "2026-09-01T08:01:30.000Z" });
  await store.appendTasteEvent({ id: "t2", accountId: ACCT, routineId: "D05-W01", action: "held", context: {}, createdAt: "2026-09-01T08:02:00.000Z" });
  // one measured KPI: repeat purchase 14% vs 22 → miss
  await measureOutcomes(ACCT, store, new StaticReader({ "shopify:customers": { rows: Array.from({ length: 50 }, () => ({})), metrics: { repeat_count: 7 }, provenance: "ok" } }, () => NOW), { now: () => NOW, routineIds: ["D05-W01"] });
  return store;
}

describe("weekStartUtc", () => {
  it("is the Monday (UTC) of the ISO week", () => {
    expect(weekStartUtc(new Date("2026-09-02T09:00:00.000Z"))).toBe("2026-08-31"); // Wed → Mon
    expect(weekStartUtc(new Date("2026-08-31T00:00:00.000Z"))).toBe("2026-08-31"); // Mon → itself
    expect(weekStartUtc(new Date("2026-09-06T23:59:00.000Z"))).toBe("2026-08-31"); // Sun → previous Mon
    expect(weekStartUtc(new Date("2026-09-07T00:00:00.000Z"))).toBe("2026-09-07");
  });
});

describe("gatherSelfReviewEvidence", () => {
  it("collects the last 7 days: runs, drafts, approvals by routine, taste patterns and the measured KPI — nothing older", async () => {
    const store = await seed(new MemoryStore());
    const ev = await gatherSelfReviewEvidence(store, ACCT, NOW);
    expect(ev.weekStart).toBe("2026-08-31");
    expect(ev.totals).toEqual({ receipts: 4, runsDone: 3, runsFailed: 1, drafts: 3, approved: 2, held: 1, pending: 1, routinesOn: 3 });
    const byId = Object.fromEntries(ev.routines.map((r) => [r.id, r]));
    expect(byId["D01-W01"]).toMatchObject({ name: "Founder content engine", enabled: true, cadence: "0 7 * * *", runsDone: 2, drafts: 2, approved: 2, held: 0, kpi: null });
    expect(byId["D05-W01"]).toMatchObject({ enabled: true, runsDone: 1, drafts: 1, held: 1, kpi: { key: "repeat_purchase_pct", target: 22, actual: 14, hit: false, unit: "%" } });
    expect(byId["D05-W04"]).toMatchObject({ enabled: true, runsDone: 0, drafts: 0 }); // on but idle — a "disable" target
    expect(byId["D02-W01"]).toMatchObject({ enabled: false, runsFailed: 1 });
    expect(ev.taste).toEqual({ approvedRatePct: 67, heldRoutines: ["D05-W01"], whyOpened: 1, edited: 0 });
    expect(ev.outcomes).toEqual({ hit: 0, miss: 1, unmeasured: 0 });
  });
});

function evidenceFixture(): SelfReviewEvidence {
  return {
    weekStart: "2026-08-31",
    windowStart: "2026-08-26T09:00:00.000Z",
    windowEnd: "2026-09-02T09:00:00.000Z",
    totals: { receipts: 4, runsDone: 3, runsFailed: 1, drafts: 3, approved: 2, held: 1, pending: 1, routinesOn: 3 },
    routines: [
      { id: "D01-W01", name: "Founder content engine", enabled: true, cadence: "0 7 * * *", runsDone: 2, runsFailed: 0, runsSkipped: 0, drafts: 2, approved: 2, held: 0, kpi: null },
      { id: "D05-W01", name: "Welcome flow tuning", enabled: true, cadence: "0 8 * * 1", runsDone: 1, runsFailed: 0, runsSkipped: 0, drafts: 1, approved: 0, held: 1, kpi: { key: "repeat_purchase_pct", label: "Repeat purchase rate (90d)", unit: "%", target: 22, actual: 14, hit: false, provenance: "ok" } },
      { id: "D05-W04", name: "Winback campaign prep", enabled: true, cadence: "0 8 * * 1", runsDone: 0, runsFailed: 0, runsSkipped: 0, drafts: 0, approved: 0, held: 0, kpi: null },
    ],
    taste: { approvedRatePct: 67, heldRoutines: ["D05-W01"], whyOpened: 1, edited: 0 },
    outcomes: { hit: 0, miss: 1, unmeasured: 0 },
  };
}

describe("parseSelfReview — adversarial model output", () => {
  const ev = evidenceFixture();
  const good = {
    worked: "I completed 3 runs and handed over 3 drafts; you approved 2 of them. Repeat purchase is at 14% against the 22% contract.",
    changing: "You held the welcome-flow proposal, so I am reprioritising Welcome flow tuning and moving Winback campaign prep off the weekly slot until the flow lands.",
    ask: "What made the welcome-flow proposal a hold rather than a yes?",
    changes: [
      { action: "reprioritise", routineId: "D05-W01", why: "Repeat purchase is at 14% against a 22% target." },
      { action: "adjust_cadence", routineId: "D05-W04", cadence: "manual", why: "It completed nothing this week." },
    ],
  };

  it("accepts a clean review: three live fields, both real changes kept", () => {
    const p = parseSelfReview(good, ev);
    expect(p.liveFields).toBe(3);
    expect(p.rejected).toEqual([]);
    expect(p.review.worked).toBe(good.worked);
    expect(p.review.ask).toBe(good.ask);
    expect(p.review.changes).toEqual([
      { action: "reprioritise", routineId: "D05-W01", why: "Repeat purchase is at 14% against a 22% target." },
      { action: "adjust_cadence", routineId: "D05-W04", cadence: "manual", why: "It completed nothing this week." },
    ]);
  });

  it("an invented number in a field rejects that field (falls back to the deterministic copy); the others stand", () => {
    const p = parseSelfReview({ ...good, worked: "I completed 47 runs and lifted repeat purchase to 31%." }, ev);
    expect(p.liveFields).toBe(2);
    expect(p.review.worked).toBe(deterministicSelfReview(ev).worked);
    expect(p.review.changing).toBe(good.changing);
    // arithmetic on evidence numbers is still an invented number (small counts 1–12 are allowed by design)
    expect(parseSelfReview({ ...good, changing: "That is a gap of 18 points I intend to close." }, ev).review.changing).toBe(deterministicSelfReview(ev).changing);
  });

  it("invented changes are rejected: unknown action, unknown routine, enabling what is on, disabling what is off, bad cadence, cadence on an idle-off routine", () => {
    const p = parseSelfReview(
      {
        ...good,
        changes: [
          { action: "delete", routineId: "D05-W01", why: "x" },
          { action: "enable", routineId: "D09-W99", why: "x" },
          { action: "enable", routineId: "D01-W01", why: "already on" },
          { action: "disable", routineId: "D02-W01", why: "already off" },
          { action: "adjust_cadence", routineId: "D05-W04", cadence: "every tuesday", why: "x" },
          { action: "adjust_cadence", routineId: "D03-W01", cadence: "0 7 * * *", why: "off, so nothing to reschedule" },
          { action: "disable", routineId: "D05-W04", why: "It ran nothing this week." },
          { action: "enable", routineId: "D05-W06", why: "Reviews lift repeat purchase." },
        ],
      },
      ev,
    );
    expect(p.review.changes).toEqual([
      { action: "disable", routineId: "D05-W04", why: "It ran nothing this week." },
      { action: "enable", routineId: "D05-W06", why: "Reviews lift repeat purchase." },
    ]);
    expect(p.rejected).toEqual([
      'unknown action "delete"',
      'unknown routine "D09-W99"',
      "D01-W01 is already on",
      "D02-W01 is already off",
      'invalid cadence "every tuesday"',
      "D03-W01 is off — nothing to re-schedule",
    ]);
    expect(rejectChange({ action: "reprioritise", routineId: "D05-W01" }, ev)).toBe("missing why");
    // a why with an invented number is not stored either
    expect(parseSelfReview({ ...good, changes: [{ action: "reprioritise", routineId: "D05-W01", why: "It is 19 points behind." }] }, ev).review.changes).toEqual([]);
  });

  it("a missing, multi-question, or statement 'ask' falls back to the deterministic ask", () => {
    const fb = deterministicSelfReview(ev).ask;
    expect(parseSelfReview({ ...good, ask: undefined }, ev).review.ask).toBe(fb);
    expect(parseSelfReview({ ...good, ask: "Why the hold? And should I stop?" }, ev).review.ask).toBe(fb);
    expect(parseSelfReview({ ...good, ask: "Tell me why you held it." }, ev).review.ask).toBe(fb);
    expect(parseSelfReview({ ...good, ask: "Should I stop after 3 holds?" }, ev).review.ask).toBe("Should I stop after 3 holds?");
  });

  it("markdown, emojis, exclamation marks and non-strings are rejected per field; garbage input is all-fallback", () => {
    const fb = deterministicSelfReview(ev);
    expect(parseSelfReview({ ...good, worked: "**Big week** — 3 runs done." }, ev).review.worked).toBe(fb.worked);
    expect(parseSelfReview({ ...good, worked: "3 runs done 🚀" }, ev).review.worked).toBe(fb.worked);
    expect(parseSelfReview({ ...good, worked: "3 runs done!" }, ev).review.worked).toBe(fb.worked);
    expect(parseSelfReview({ ...good, changing: 42 }, ev).review.changing).toBe(fb.changing);
    expect(parseSelfReview("not json", ev)).toEqual({ review: fb, liveFields: 0, rejected: [] });
    expect(parseSelfReview(null, ev).liveFields).toBe(0);
  });

  it("the allowed-number set is exactly the evidence's numbers plus small counts, and the prompt carries the evidence + the rules", () => {
    const allowed = allowedNumbers(ev);
    expect(allowed.has("14")).toBe(true);
    expect(allowed.has("67")).toBe(true);
    expect(allowed.has("12")).toBe(true);
    expect(allowed.has("13")).toBe(false);
    expect(allowed.has("47")).toBe(false);
    expect(buildSelfReviewUserMessage(ev)).toContain('"repeat_purchase_pct"');
    expect(SELF_REVIEW_SYSTEM).toMatch(/ONLY numbers you may write/);
    expect(SELF_REVIEW_SYSTEM).toMatch(/enable|disable|reprioritise|adjust_cadence/);
  });
});

describe("deterministicSelfReview", () => {
  it("writes from the numbers only, proposes real levers for measured misses, and asks about the held proposal", () => {
    const r = deterministicSelfReview(evidenceFixture());
    expect(r.worked).toBe("I completed 3 runs and handed over 3 drafts; you approved 2 and held 1. 0 of 1 measured KPI contracts hit their target.");
    expect(r.changes).toEqual([
      { action: "reprioritise", routineId: "D05-W01", why: "Repeat purchase rate (90d) came in at 14 against a target of 22 %." },
      { action: "reprioritise", routineId: "D05-W04", why: "Winback campaign prep is on but completed nothing this week — I am moving it up the queue." },
    ]);
    expect(r.changing).toMatch(/^I am reprioritising Welcome flow tuning and Winback campaign prep: /);
    expect(r.ask).toBe("You held D05-W01 this week — what would have made that proposal an easy yes?");
    // every number it wrote is in the evidence
    const allowed = allowedNumbers(evidenceFixture());
    for (const t of [r.worked, r.changing, r.ask, ...r.changes.map((c) => c.why)]) expect((t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) => allowed.has(n))).toBe(true);
  });
  it("a quiet week says so and asks the neutral question", () => {
    const ev: SelfReviewEvidence = { ...evidenceFixture(), totals: { receipts: 0, runsDone: 0, runsFailed: 0, drafts: 0, approved: 0, held: 0, pending: 0, routinesOn: 2 }, routines: [], taste: { approvedRatePct: null, heldRoutines: [], whyOpened: 0, edited: 0 }, outcomes: { hit: 0, miss: 0, unmeasured: 0 } };
    const r = deterministicSelfReview(ev);
    expect(r.worked).toBe("Quiet week — nothing completed across 2 routines on. I have no result to claim.");
    expect(r.changes).toEqual([]);
    expect(r.changing).toMatch(/^Nothing is changing this week/);
    expect(r.ask).toBe("Is there one routine you want me to run more, or less, next week?");
  });
  it("composeBody / splitBody round-trip", () => {
    const r = deterministicSelfReview(evidenceFixture());
    expect(splitBody(composeBody(r))).toEqual({ worked: r.worked, changing: r.changing, ask: r.ask });
    expect(splitBody("free text")).toEqual({ worked: "free text", changing: "", ask: "" });
  });
});

describe("generateSelfReview", () => {
  it("without a model stores the deterministic review; idempotent per week (one row, rewritten)", async () => {
    const store = await seed(new MemoryStore());
    const a = await generateSelfReview({ store, accountId: ACCT, now: () => NOW, llm: null });
    expect(a.author).toBe("deterministic");
    expect(a.record.weekStart).toBe("2026-08-31");
    expect(a.record.changes[0]).toMatchObject({ action: "reprioritise", routineId: "D05-W01" });
    const b = await generateSelfReview({ store, accountId: ACCT, now: () => new Date("2026-09-04T09:00:00.000Z"), llm: null });
    expect(b.record.id).toBe(a.record.id); // same week → same row
    expect((await store.getLatestSelfReview(ACCT))?.createdAt).toBe("2026-09-04T09:00:00.000Z");
    const c = await generateSelfReview({ store, accountId: ACCT, now: () => new Date("2026-09-08T09:00:00.000Z"), llm: null });
    expect(c.record.weekStart).toBe("2026-09-07");
    expect((await store.getLatestSelfReview(ACCT))?.weekStart).toBe("2026-09-07");
  });
  it("with a model: validated fields land; a refusal or invalid output falls back to deterministic; evidence records the author", async () => {
    const store = await seed(new MemoryStore());
    const llm = { complete: async () => JSON.stringify({ worked: "I completed 3 runs and you approved 2.", changing: "I am reprioritising Welcome flow tuning.", ask: "Was the hold about the offer or the timing?", changes: [{ action: "fly", routineId: "D05-W01", why: "x" }] }) };
    const g = await generateSelfReview({ store, accountId: ACCT, now: () => NOW, llm });
    expect(g.author).toBe("sonnet");
    expect(g.liveFields).toBe(3);
    expect(g.rejected).toEqual(['unknown action "fly"']);
    expect(g.record.body).toBe("What worked\nI completed 3 runs and you approved 2.\n\nWhat I'm changing\nI am reprioritising Welcome flow tuning.\n\nOne ask\nWas the hold about the offer or the timing?");
    expect(g.record.evidence).toMatchObject({ author: "sonnet", liveFields: 3, ask: "Was the hold about the offer or the timing?" });

    const refusing = { complete: async () => { throw new Error("refusal"); } };
    const r = await generateSelfReview({ store, accountId: ACCT, now: () => NOW, llm: refusing });
    expect(r.author).toBe("deterministic");
    const invented = { complete: async () => JSON.stringify({ worked: "I made you 900 dollars.", changing: "Everything, 12x.", ask: "Ok?" }) };
    const i = await generateSelfReview({ store, accountId: ACCT, now: () => NOW, llm: invented });
    expect(i.author).toBe("sonnet"); // "Ok?" is a valid ask, "Everything, 12x." has an allowed small count
    expect(splitBody(i.record.body).worked).toBe(deterministicSelfReview(i.evidence).worked);
  });
});
