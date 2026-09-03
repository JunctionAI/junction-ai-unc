/* Accounts mode never renders demo furniture (docs/PRODUCT-EXPERIENCE.md "Real only"):
   the pure helpers behind the Sidebar / Strategy / corner-buddy copy, and buildUncContext in
   account mode — no AP_DATA approvals, no SIGNAL/LEVER/COMPLETED demo rows, connectors and
   routines from the account only, the strategy rationale without the demo "12 Aug". */

import { describe, expect, it } from "vitest";
import { AP_DATA, COMPLETED_DEFS, LEVER_DEFS, SIGNAL_DEFS } from "@/lib/platform/derive";
import { initialState } from "@/lib/platform/state";
import { connectorSummary, draftsThisWeek, enabledCount, homeBubble, pendingCount, stripDemoSeed, type AccountFacts } from "../accountFacts";
import { accountStrategyWhy, buildUncContext } from "../context";

const NOW = new Date("2026-09-02T09:00:00.000Z");

export function facts(over: Partial<AccountFacts> = {}): AccountFacts {
  return {
    accountId: "acct-1",
    connectors: [
      { platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" },
      { platform: "ga4", name: "Google Analytics 4", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" },
      { platform: "klaviyo", name: "Klaviyo", status: "needs_reconnect", lastSyncAt: null, lastSyncResult: "error:token_expired" },
      { platform: "meta_ads", name: "Meta Ads", status: "disconnected", lastSyncAt: null, lastSyncResult: null },
    ],
    routineStates: [
      { routineId: "D01-W01", name: "Founder content engine", enabled: true },
      { routineId: "D01-W05", name: "Social repurposing", enabled: true },
      { routineId: "D05-W01", name: "Welcome flow tuning", enabled: true },
      { routineId: "D05-W02", name: "Abandoned cart recovery", enabled: false },
    ],
    plan: {
      title: "Brand-led organic",
      agreedAt: "2026-08-20T03:00:00.000Z",
      phases: [
        { n: "1", name: "Organic brand engine", status: "ACTIVE", routines: ["Founder content engine", "Social repurposing", "Customer-question mining"], from_you: "~2 h/wk — your voice." },
        { n: "2", name: "Retention & lifecycle", status: "NOW", routines: ["Winback campaign prep", "Welcome flow tuning", "Review request timing"], from_you: "~20 min/day clearing approvals." },
        { n: "3", name: "Paid amplification", status: "GATED · repeat ≥ 18%", routines: ["Daily paid decisioning", "Organic-to-paid promotion"], from_you: "Weekly budget sign-off." },
      ],
    },
    resources: { budgetMonthly: 1200, hoursWeekly: 4, skills: ["Writing", "Community"], postures: ["brand_led"] },
    approvals: [{ id: "ap-1", routineId: "D05-W01", title: "Send welcome email 2 to 40 new subscribers", detail: "Zero-recipient test passed.", before: "0 recipients", after: "40 recipients", reasoning: "All 40 joined in the last 7 days.", status: "pending", expiresAt: "2026-09-03T09:00:00.000Z", decidedAt: null }],
    decided: [{ id: "ap-0", routineId: "D01-W01", title: "Publish founder post", detail: "", before: "Draft", after: "Published", reasoning: "", status: "held", expiresAt: null, decidedAt: "2026-09-01T09:00:00.000Z" }],
    runs: [
      { id: "run-3", routineId: "D01-W01", mode: "dry_run", status: "done", startedAt: "2026-09-02T07:00:00.000Z" },
      { id: "run-2", routineId: "D05-W01", mode: "dry_run", status: "done", startedAt: "2026-09-01T07:00:00.000Z" },
      { id: "run-1", routineId: "D01-W05", mode: "dry_run", status: "done", startedAt: "2026-08-10T07:00:00.000Z" },
      { id: "run-0", routineId: "D01-W05", mode: "dry_run", status: "failed", startedAt: "2026-09-02T06:00:00.000Z" },
    ],
    receipts: [{ id: "rc-1234abcd", kind: "draft", text: "Drafted 3 founder posts from 12 customer questions", createdAt: "2026-09-02T07:01:00.000Z" }],
    fetchedAt: NOW.toISOString(),
    ...over,
  };
}

describe("account facts — pure copy helpers", () => {
  it("connectorSummary: counts connected, names the one platform needing attention, honest when nothing is connected", () => {
    expect(connectorSummary(facts())).toBe("2 connected · Klaviyo needs attention");
    expect(connectorSummary(facts({ connectors: [{ platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" }] }))).toBe("1 connected");
    expect(connectorSummary(facts({ connectors: [{ platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: null, lastSyncResult: null }] }))).toBe("Nothing connected yet");
    expect(connectorSummary(facts({ connectors: [{ platform: "klaviyo", name: "Klaviyo", status: "error", lastSyncAt: null, lastSyncResult: "error:first_read" }, { platform: "meta_ads", name: "Meta Ads", status: "needs_reconnect", lastSyncAt: null, lastSyncResult: "error:token_expired" }] }))).toBe("2 need attention");
    expect(connectorSummary(facts({ connectors: [{ platform: "meta_ads", name: "Meta Ads", status: "disconnected", lastSyncAt: null, lastSyncResult: null }] }))).toBe("Nothing connected yet");
    expect(connectorSummary(null)).toBe("Nothing connected yet");
  });

  it("enabledCount / pendingCount / draftsThisWeek read only real rows", () => {
    expect(enabledCount(facts())).toBe(3);
    expect(enabledCount(null)).toBe(0);
    expect(pendingCount(facts())).toBe(1);
    // two dry runs done in the last 7 days; the 10 Aug one and the failed one don't count
    expect(draftsThisWeek(facts(), NOW)).toBe(2);
    expect(draftsThisWeek(null, NOW)).toBe(0);
  });

  it("homeBubble: real counts, or the honest first step when nothing is on", () => {
    expect(homeBubble(facts(), NOW)).toBe("3 routines on · 1 decision waiting · 2 drafts this week.");
    expect(homeBubble(facts({ approvals: [], runs: [] }), NOW)).toBe("3 routines on · nothing waiting on you.");
    expect(homeBubble(facts({ routineStates: [] }), NOW)).toBe("Nothing running yet — turn on your first routine and I’ll have a draft here within the hour.");
    expect(homeBubble(null, NOW)).toBe("Nothing running yet — turn on your first routine and I’ll have a draft here within the hour.");
    for (const demoLine of ["Only you can clear these", "Three taps and the machine keeps moving", "48.2k"]) expect(homeBubble(facts(), NOW)).not.toContain(demoLine);
  });

  it("stripDemoSeed drops exactly the prototype's leading lines and nothing else", () => {
    const seed = initialState.messages.map((m) => m.text);
    const real = [{ text: "How's the welcome flow going?" }, { text: "Waiting on Klaviyo." }];
    expect(stripDemoSeed([...initialState.messages, ...real], seed)).toEqual(real);
    expect(stripDemoSeed(real, seed)).toEqual(real);
    expect(stripDemoSeed([initialState.messages[0], ...real], seed)).toEqual([initialState.messages[0], ...real]); // partial ≠ seed
    expect(stripDemoSeed([], seed)).toEqual([]);
  });
});

describe("buildUncContext in account mode — no demo furniture", () => {
  const S = { ...initialState, onboarded: true, routineOn: { "Founder content engine": true }, connState: { Shopify: "ok" as const } };

  it("keeps the demo shape (same key set) so the prompt and the evals don't drift", () => {
    const demo = buildUncContext(initialState);
    const acct = buildUncContext(S, { mode: "account", facts: facts(), now: NOW });
    expect(Object.keys(acct).sort()).toEqual(Object.keys(demo).sort());
    expect(Object.keys(acct.goal).sort()).toEqual(Object.keys(demo.goal).sort());
    expect(Object.keys(acct.strategy).sort()).toEqual(Object.keys(demo.strategy).sort());
  });

  it("approvals, receipts, signals and levers: the account's rows or nothing — never AP_DATA / SIGNAL_DEFS / LEVER_DEFS / COMPLETED_DEFS", () => {
    const acct = buildUncContext(S, { mode: "account", facts: facts(), now: NOW });
    const dump = JSON.stringify(acct);
    for (const a of AP_DATA) expect(dump).not.toContain(a.title);
    for (const s of SIGNAL_DEFS) expect(dump).not.toContain(s.value);
    for (const l of LEVER_DEFS) expect(dump).not.toContain(l.impact);
    for (const c of COMPLETED_DEFS) expect(dump).not.toContain(c.receipt);
    expect(acct.approvalsPending).toEqual([{ routine: "D05-W01", title: "Send welcome email 2 to 40 new subscribers", detail: "Zero-recipient test passed.", before: "0 recipients", after: "40 recipients", expiry: "expires in 24h", status: "pending", reasoning: "All 40 joined in the last 7 days." }]);
    expect(acct.approvalsRecent[0]).toMatchObject({ title: "Publish founder post", status: "held", expiry: "decided 2026-09-01" });
    expect(acct.signals).toEqual([]);
    expect(acct.levers).toEqual([]);
    expect(acct.recentReceipts).toEqual([{ text: "Drafted 3 founder posts from 12 customer questions", receipt: "Receipt rc-1234a · draft · 2026-09-02" }]);
    expect(acct.today).toBe("2026-09-02");
  });

  it("without facts (rows not loaded yet): empty lists, never the demo ones", () => {
    const acct = buildUncContext(S, { mode: "account", now: NOW });
    expect(acct.approvalsPending).toEqual([]);
    expect(acct.approvalsRecent).toEqual([]);
    expect(acct.recentReceipts).toEqual([]);
    expect(acct.signals).toEqual([]);
  });

  it("connectors: the account's status per platform, 'disconnected' for anything it has never connected (not the catalog's demo 'ok')", () => {
    const acct = buildUncContext(S, { mode: "account", facts: facts(), now: NOW });
    const by = Object.fromEntries(acct.connectors.map((c) => [c.name, c.status]));
    expect(by.Shopify).toBe("connected");
    expect(by.Klaviyo).toBe("needs_reconnect");
    expect(by["Meta Ads"]).toBe("disconnected");
    expect(by.Instagram).toBe("disconnected"); // demo default is "ok"
    expect(by.Slack).toBe("disconnected"); // demo default is "ok"
    // no facts: the hydrated state alone, unknown → disconnected
    const noFacts = buildUncContext(S, { mode: "account", now: NOW });
    expect(Object.fromEntries(noFacts.connectors.map((c) => [c.name, c.status]))).toMatchObject({ Shopify: "connecting", Instagram: "disconnected", Klaviyo: "disconnected" });
    // demo keeps the prototype's defaults
    expect(Object.fromEntries(buildUncContext(initialState).connectors.map((c) => [c.name, c.status]))).toMatchObject({ Instagram: "ok", Klaviyo: "expired" });
  });

  it("routines: only what is really enabled (facts ∪ state), not the catalog's demo 'Active' flags", () => {
    const acct = buildUncContext(S, { mode: "account", facts: facts(), now: NOW });
    expect(acct.routines.active.sort()).toEqual(["Founder content engine", "Social repurposing", "Welcome flow tuning"]);
    expect(acct.routines.activeCount).toBe(3);
    const noFacts = buildUncContext(S, { mode: "account", now: NOW });
    expect(noFacts.routines.active).toEqual(["Founder content engine"]);
    expect(buildUncContext(initialState).routines.activeCount).toBeGreaterThan(3); // demo: catalog defaults
  });

  it("strategy: the agreed plan's phases with honest statuses and agreedAt; the rationale from the founder's own numbers with no demo date", () => {
    const acct = buildUncContext(S, { mode: "account", facts: facts(), now: NOW });
    expect(acct.strategy.agreedAt).toBe("2026-08-20T03:00:00.000Z");
    expect(acct.strategy.phases.map((p) => [p.name, p.status])).toEqual([
      ["Organic brand engine", "active"],
      ["Retention & lifecycle", "active"],
      ["Paid amplification", "ready when you are"],
    ]);
    expect(acct.strategy.why).not.toContain("12 Aug");
    expect(acct.strategy.why).toContain("Agreed with the founder on 2026-08-20");
    expect(acct.strategy.why).toContain("NZ$3,600/mo for paid, 6 h/wk");
    const draft = accountStrategyWhy({ posture: "brand", budgetMonthly: 900, hoursWk: 3, obStrengths: [], currency: "AUD" }, null);
    expect(draft).toContain("A$900/mo");
    expect(draft).toContain("no strengths picked yet");
    expect(draft).toContain("Not agreed yet");
    // demo keeps the prototype's line
    expect(buildUncContext(initialState).strategy.why).toContain("Chosen with you on 12 Aug");
    expect(buildUncContext(initialState).strategy.agreedAt).toBeNull();
  });

  it("no plan row yet: the current play's phases, phase 1 'start here' when nothing is on", () => {
    const acct = buildUncContext({ ...S, routineOn: {} }, { mode: "account", facts: facts({ plan: null, routineStates: [] }), now: NOW });
    expect(acct.strategy.phases[0]).toMatchObject({ name: "Organic brand engine", status: "start here" });
    expect(acct.strategy.phases[2].status).toBe("ready when you are");
    expect(JSON.stringify(acct.strategy.phases)).not.toContain("GATED");
  });
});
