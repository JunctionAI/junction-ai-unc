/* Taste patterns from a ledger fixture on MemoryStore: rates by category and spend bucket,
   hold reasons, decision latency, the spend ceiling (which can only ever shrink a proposal),
   the decision-prompt lines, and the account_profiles.decision_style merge. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../../runtime/store/memory";
import type { ApprovalRecord, Decision, SpendAmount } from "../../runtime/types";
import { applySpendCeiling, deriveDecisionStyle, holdReasonFor, perDay, readAccountProfile, renderProfileForDecision, renderTasteForDecision, spendBucket, suggestedSpendCeiling, tastePatterns, writeDecisionStyle, type TastePatterns } from "../taste";

const ACCT = "acct-1";
const NOW = new Date("2026-09-02T07:00:00.000Z");
const H = 3_600_000;

async function ledger() {
  const store = new MemoryStore();
  let n = 0;
  const add = async (routineId: string, status: "approved" | "held", opts: { spend?: SpendAmount; hours?: number; title?: string; holdReason?: string } = {}) => {
    n++;
    const createdAt = new Date(NOW.getTime() - (10 - n) * 24 * H).toISOString();
    const decidedAt = new Date(new Date(createdAt).getTime() + (opts.hours ?? 3) * H).toISOString();
    const runId = `run-${n}`;
    const a: ApprovalRecord = { id: `ap-${n}`, accountId: ACCT, runId, routineId, title: opts.title ?? `Proposal ${n}`, status, createdAt, decidedAt, expiresAt: new Date(new Date(createdAt).getTime() + 48 * H).toISOString() };
    await store.createApproval(a);
    await store.appendReceipt({ id: `rc-${n}`, accountId: ACCT, runId, kind: "draft", description: "Decided", payload: { spend: opts.spend ?? null }, createdAt });
    await store.appendTasteEvent({ id: `te-${n}`, accountId: ACCT, approvalId: a.id, routineId, action: status, context: opts.holdReason ? { reason: opts.holdReason } : {}, createdAt: decidedAt });
    return a;
  };
  const day = (amount: number): SpendAmount => ({ amount, currency: "NZD", period: "day" });
  // Paid ads: approved 20 and 40 /day; held 80, 120 (with a reason) and 60 /day
  await add("D02-W01", "approved", { spend: day(20), hours: 2 });
  await add("D02-W01", "approved", { spend: day(40), hours: 4 });
  await add("D02-W01", "held", { spend: day(80), hours: 6, holdReason: "too much for this week" });
  await add("D02-W01", "held", { spend: day(120), hours: 1, title: "Move NZ$120/day of budget to Prospecting NZ" });
  await add("D02-W02", "held", { spend: day(60), hours: 5, title: "Pause the tired creative" });
  // Content: two approvals, no spend
  await add("D01-W01", "approved", { hours: 3 });
  await add("D01-W01", "approved", { hours: 3 });
  await store.appendTasteEvent({ id: "te-why", accountId: ACCT, approvalId: "ap-1", routineId: "D02-W01", action: "why_opened", context: {}, createdAt: NOW.toISOString() });
  return store;
}

describe("tastePatterns", () => {
  it("rates by category and by spend bucket, hold reasons, median latency, the approved max and the holds above it", async () => {
    const p = await tastePatterns(await ledger(), ACCT, { now: () => NOW });
    expect(p).toMatchObject({ decided: 7, approved: 4, held: 3, approvalRatePct: 57, whyOpened: 1, edited: 0, medianDecisionHours: 3, maxApprovedPerDay: 40, minHeldAbovePerDay: 60, heldAboveApprovedMax: 3 });
    expect(p.byCategory).toEqual({ "Paid ads": { approved: 2, held: 3, ratePct: 40 }, Content: { approved: 2, held: 0, ratePct: 100 } });
    expect(p.bySpend).toEqual({
      none: { approved: 2, held: 0, ratePct: 100 },
      "≤20/day": { approved: 1, held: 0, ratePct: 100 },
      "20–50/day": { approved: 1, held: 0, ratePct: 100 },
      "50–100/day": { approved: 0, held: 2, ratePct: 0 },
      "100+/day": { approved: 0, held: 1, ratePct: 0 },
    });
    // the founder's own words win; a keyword bucket otherwise; nothing invented for "Pause the tired creative"
    expect(p.holdReasons).toEqual([
      { reason: "creative", count: 1 },
      { reason: "spend too high", count: 1 },
      { reason: "too much for this week", count: 1 },
    ]);
  });

  it("an empty ledger has no patterns, no ceiling and no prompt lines", async () => {
    const p = await tastePatterns(new MemoryStore(), ACCT, { now: () => NOW });
    expect(p).toMatchObject({ decided: 0, approvalRatePct: null, medianDecisionHours: null, maxApprovedPerDay: null, heldAboveApprovedMax: 0 });
    expect(suggestedSpendCeiling(p)).toBeNull();
    expect(renderTasteForDecision(p)).toEqual([]);
    expect(deriveDecisionStyle(p, NOW).risk_appetite).toBe("unknown");
  });

  it("helpers: per-day normalisation, buckets, hold reasons", () => {
    expect(perDay({ amount: 3000, currency: "NZD", period: "month" })).toBe(100);
    expect(perDay({ amount: 25, currency: "NZD", period: "day" })).toBe(25);
    expect(perDay({ amount: 0, currency: "NZD", period: "day" })).toBeNull();
    expect(["none", "≤20/day", "20–50/day", "50–100/day", "100+/day"]).toEqual([null, 20, 50, 100, 100.01].map(spendBucket));
    expect(holdReasonFor(null, { id: "x", accountId: ACCT, action: "held", context: { why: "  not   now " }, createdAt: "" })).toBe("not now");
    expect(holdReasonFor({ id: "a", accountId: ACCT, runId: "r", routineId: "D01-W01", title: "Three posts in a new tone of voice", status: "held", expiresAt: "", createdAt: "" }, null)).toBe("copy or tone");
    expect(holdReasonFor({ id: "a", accountId: ACCT, runId: "r", routineId: "D01-W01", title: "Proposal", status: "held", expiresAt: "", createdAt: "" }, null)).toBeNull();
  });
});

describe("the spend ceiling never expands", () => {
  const decision = (amount: number, period: SpendAmount["period"] = "day", currency = "NZD"): Decision => ({ optionId: "scale", label: "Scale", reasoning: "ROAS 3.1 clears the floor.", spend: { amount, currency, period } });

  it("ceiling = the approved max once ≥ 2 proposals above it were held; null before that", async () => {
    const p = await tastePatterns(await ledger(), ACCT, { now: () => NOW });
    expect(suggestedSpendCeiling(p)).toBe(40);
    const one: TastePatterns = { ...p, heldAboveApprovedMax: 1 };
    expect(suggestedSpendCeiling(one)).toBeNull();
    expect(suggestedSpendCeiling({ ...p, maxApprovedPerDay: null })).toBeNull();
  });

  it("shrinks a proposal above the ceiling and says so; leaves everything else exactly as proposed", () => {
    const shrunk = applySpendCeiling(decision(80), 40, "NZD");
    expect(shrunk.spend).toEqual({ amount: 40, currency: "NZD", period: "day" });
    expect(shrunk.reasoning).toBe("ROAS 3.1 clears the floor. Kept under your usual NZ$40/day (you have held the larger shifts).");
    expect(applySpendCeiling(decision(3000, "month"), 40, "NZD").spend).toEqual({ amount: 1200, currency: "NZD", period: "month" });
    // at or under the ceiling: untouched (never expanded up to it)
    expect(applySpendCeiling(decision(20), 40, "NZD")).toEqual(decision(20));
    expect(applySpendCeiling(decision(40), 40, "NZD")).toEqual(decision(40));
    // no ceiling, no spend, other currency: untouched
    expect(applySpendCeiling(decision(80), null, "NZD")).toEqual(decision(80));
    expect(applySpendCeiling({ optionId: "hold", label: "Hold", reasoning: "x", terminal: true }, 40, "NZD")).toEqual({ optionId: "hold", label: "Hold", reasoning: "x", terminal: true });
    expect(applySpendCeiling(decision(80, "day", "AUD"), 40, "NZD")).toEqual(decision(80, "day", "AUD"));
  });
});

describe("what the decision prompt sees", () => {
  it("2–4 lines with only the ledger's numbers, the ceiling line first among the spend lines", async () => {
    const p = await tastePatterns(await ledger(), ACCT, { now: () => NOW });
    const lines = renderTasteForDecision(p, { options: [{ id: "scale", label: "Scale", spend: { amount: 80, period: "day" } }] });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[0]).toBe("This founder has decided 7 proposals in the last 90 days: approved 4, held 3, typically within 3 h.");
    expect(lines[1]).toBe("They have held 3 of 3 budget shifts above NZ$40/day — propose within that ceiling or explain why not.");
    expect(lines[2]).toBe("Approval rate by area: Content 100% (2), Paid ads 40% (5).");
    expect(lines[3]).toBe("Typical hold reasons: creative (1), spend too high (1), too much for this week (1).");
  });

  it("profile lines from account_profiles; empty when unknown", () => {
    expect(renderProfileForDecision(null)).toEqual([]);
    expect(renderProfileForDecision({ tone: { formality: "casual", length: "short" }, decisionStyle: { risk_appetite: "measured", approval_rate: 57, median_decision_hours: 3 }, cadence: {}, channels: {}, founderNotes: "Ask before touching the budget." })).toEqual([
      "Tone: formality casual, length short.",
      "Decision style: risk appetite measured, approves 57% of proposals, decides within ~3 h.",
      "Founder's note on working with them: Ask before touching the budget.",
    ]);
  });
});

describe("account_profiles.decision_style", () => {
  it("derives the style and merges ONLY the decision_style key — tone, cadence and founder-set keys survive", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Example" }]);
    db.seed("account_profiles", [{ account_id: ACCT, tone: { formality: "casual" }, decision_style: { founder_set: "cautious please" }, cadence: { timezone: "Pacific/Auckland" }, channels: { slack: true }, founder_notes: "Be brief." }]);
    const p = await tastePatterns(await ledger(), ACCT, { now: () => NOW });
    const style = deriveDecisionStyle(p, NOW);
    expect(style).toEqual({ approval_rate: 57, median_decision_hours: 3, holds_by_kind: { "Paid ads": 3 }, risk_appetite: "measured", spend_ceiling_per_day: 40, currency: "NZD", decided: 7, derived_at: NOW.toISOString(), window_days: 90 });
    await writeDecisionStyle(db, ACCT, style, NOW);
    const row = db.rows("account_profiles")[0];
    expect(row.tone).toEqual({ formality: "casual" });
    expect(row.cadence).toEqual({ timezone: "Pacific/Auckland" });
    expect(row.channels).toEqual({ slack: true });
    expect(row.founder_notes).toBe("Be brief.");
    expect(row.decision_style).toEqual({ founder_set: "cautious please", ...style });
    expect(row.updated_at).toBe(NOW.toISOString());
    expect(db.callsFor("account_profiles", "upsert")).toHaveLength(0); // atomic context RPC, not read/merge/write
    // a first write creates the row
    const fresh = new FakeSupabase();
    fresh.seed("accounts", [{ id: "acct-2" }]);
    await writeDecisionStyle(fresh, "acct-2", style, NOW);
    expect(fresh.rows("account_profiles")).toHaveLength(1);
    expect(await readAccountProfile(fresh, "acct-2")).toMatchObject({ tone: {}, decisionStyle: style, founderNotes: null });
    expect(await readAccountProfile(fresh, "acct-3")).toBeNull();
  });
});
