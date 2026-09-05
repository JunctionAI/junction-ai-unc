/* Accounts mode renders NOTHING from derive.ts's demo constants — asserted as a list of demo
   phrases that must be absent in every accounts-mode state (loading, empty, populated), while
   the copy floor of docs/PRODUCT-EXPERIENCE.md is present. Covers Home, the Routines view +
   routine detail, the Connectors view and the onboarding defaults; plus derive() itself in
   `mode: "account"` (the root cause: `effConn = connState || catalog.st` and
   `isOn = routineOn ?? state === "Active"` leaked the demo for anything a real account never
   touched). Rendered with react-dom/server (no DOM, no fetch). Demo mode is untouched: the same
   phrases ARE there. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AP_DATA, AP_WHY_TEXTS, COMPLETED_DEFS, LEVER_DEFS, SIGNAL_DEFS, derive, type DeriveOptions } from "@/lib/platform/derive";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import { planReasoning } from "@/lib/platform/plan";
import { accountInitialState, currencyForLocale, initialState, type PlatformState } from "@/lib/platform/state";
import { HOME_COPY } from "@/lib/setup/home";
import { computeSetupProgress } from "@/lib/setup/progress";
import type { AccountFacts } from "@/lib/unc/accountFacts";
import type { ConnectorsStateListing } from "@/lib/connectors/state";
import type { RoutinesStateListing, RoutineStateView } from "@/lib/runtime/routinesState";
import { BRIEF_GREETING } from "../TodayBrief";
import HomeView, { type HomeViewProps } from "../HomeView";
import ConnectDataStep from "../ConnectDataStep";
import type { BusinessProfile } from "@/lib/unc/scan";
import Onboarding, { OB_BUDGET_UNSET_NOTE, OB_PLACEHOLDERS, PLAN_GATE_TITLE } from "../Onboarding";
import ConnectorsView from "../ConnectorsView";
import RoutineDetail from "../RoutineDetail";
import RoutinesView from "../RoutinesView";
import type { LiveApprovals } from "../useLiveApprovals";
import type { HomeTelemetryState } from "../useHomeTelemetry";
import type { SetupProgressState } from "@/lib/setup/useSetupProgress";

const noop = () => {};
const esc = (t: string) => t.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const NOW = new Date("2026-09-02T09:00:00.000Z");
const ACCOUNT: DeriveOptions = { mode: "account", now: NOW };
const dv = (S: PlatformState, opts?: DeriveOptions) => derive(S, noop, undefined, undefined, opts);
/** Home renders: `accountMode` in the props ⇒ derive runs in accounts mode too (as Platform.tsx wires it). */
const render = (S: PlatformState, props: Partial<HomeViewProps> = {}, facts?: AccountFacts) => renderToStaticMarkup(createElement(HomeView, { V: dv(S, props.accountMode ? { ...ACCOUNT, facts } : undefined), ...props }));
const storedFacts = (plan: AccountFacts["plan"]): AccountFacts => ({ accountId: "test-account", plan, connectors: [], resources: null, routineStates: [], approvals: [], decided: [], runs: [], receipts: [], fetchedAt: NOW.toISOString() });

const liveList = (over: Partial<LiveApprovals> = {}): LiveApprovals => ({ active: true, loading: false, error: null, approvals: [], pendingCount: 0, receipts: [], drafts: [], refresh: noop, ...over });
const setupState = (over: Partial<Parameters<typeof computeSetupProgress>[0]> = {}): SetupProgressState => ({
  active: true,
  loading: false,
  error: null,
  refresh: noop,
  data: computeSetupProgress({ plans: [], connectors: [], routineStates: [], runs: [], firstTasteEventAt: null, latestBrief: null, clientState: null, resourceProfile: { postures: ["brand_led"], skills: ["Writing"], budget_monthly: 3600 }, ...over }, new Date("2026-09-02T09:00:00Z")),
});

/** Every demo string that used to have a render path on Home. */
const DEMO_PHRASES: string[] = [
  ...AP_DATA.map((a) => a.title),
  ...AP_DATA.map((a) => a.detail),
  ...AP_WHY_TEXTS,
  ...SIGNAL_DEFS.map((s) => s.value),
  ...LEVER_DEFS.map((l) => l.name),
  ...COMPLETED_DEFS.map((c) => c.text),
  ...COMPLETED_DEFS.map((c) => c.receipt),
  "Platforms connected",
  "History imported",
  "Site & socials scanned",
  "Numbers certified",
  "connect more",
  "I've done the work below",
  "I’ve done the work below",
  "Nothing needs you right now — the machine is running",
  "Klaviyo token expired — 2 minutes to fix",
  "Winback and welcome are paused",
  "Reconnected Klaviyo",
  "Token verified, freshness green",
  "you’re at 3",
  "you’re at 14%",
  "What DTC brands at your target ship",
  "The category norm at NZ$40k MRR",
  "Businesses that hit goals like yours reply same-morning",
  "Queue 2 more drafts / week",
  "Fully OP",
  "Getting started",
  "to unlock",
  "Pro move",
  "Your welcome flow converts 2.1%",
  "Reviews lift repeat purchase ~9%",
  "The free CRO path",
  "Needs Klaviyo reconnect",
  "Building · dry run tonight",
  "Researching 24 new leads",
  "Winback flow blocked",
  "Tomorrow 07:00 — daily paid decisioning",
  "Friday — weekly learning review",
  "Completed today",
  "Chosen with you on 12 Aug",
  "R-449",
  "R-448",
  /* the onboarding defaults (state.ts initialState) — a real founder never sees them pre-filled
     ("NZ$40,000 MRR" itself is allowed as the goal input's placeholder — asserted as a value below) */
  'value="NZ$40,000 MRR"',
  "NZ$28,400 MRR today",
  "28400",
  "NZ$3,600/mo",
  "6 h/wk",
  "Writing &amp; product",
  "Writing · Product",
  /* routines / routine detail / connectors demo furniture */
  "saves ~",
  "Draft mode",
  "v12 · active",
  "Named approver · Tom",
  "Validation passed on demonstration data",
  "Klaviyo — reconnect",
  "Dry run tonight",
  "3 examples in your voice",
  "5 connected · 1 needs attention · 10 available",
  "Reconnected Klaviyo",
];

/* A real account's state with the founder's own answers (the empty seed + what these tests need typed in). */
const base: PlatformState = { ...accountInitialState("NZD"), onboarded: true, view: "today", goalTitle: "NZ$50,000 MRR", targetNum: 50000, deadline: "2026-12-31", obAnswered: { target: true, budget: true, hours: true }, obStrengths: ["Writing"], budgetMo: 1200, hoursWk: 5 };

function expectNoDemo(html: string) {
  for (const p of DEMO_PHRASES) {
    expect(html, `demo phrase leaked into accounts-mode Home: "${p}"`).not.toContain(p);
    expect(html).not.toContain(esc(p));
  }
}

describe("Home in accounts mode — no demo constant can render", () => {
  it("the demo phrases are on the demo Home (so the list is a real guard)", () => {
    const html = render({ ...initialState, onboarded: true, view: "today" });
    expect(html).toContain(esc(AP_DATA[0].title));
    expect(html).toContain("Platforms connected");
    expect(html).toContain("to unlock");
    expect(html).toContain("Researching 24 new leads");
    expect(html).toContain(esc(COMPLETED_DEFS[0].text));
  });

  it("while everything is still loading: nothing demo, the loading line", () => {
    const html = render(base, { accountMode: true, live: liveList({ active: false, loading: true }), telemetry: null, setup: { active: false, loading: true, data: null, error: null, refresh: noop } });
    expectNoDemo(html);
    expect(html).toContain("needs-you-loading");
    expect(html).toContain("getting-set-up-loading");
    // the bar shows the honest reference cards, never the demo "you're at N"
    expect((html.match(/data-testid="bar-card"/g) ?? []).length).toBe(3);
    expect(html).toContain("Not measured yet");
    expect(html).toContain("Industry reference — not yet from Junction accounts.");
  });

  it("empty account, everything in hand: the copy floor everywhere, no demo, no automation strip before the first run", () => {
    const html = render(base, { accountMode: true, live: liveList(), setup: setupState(), briefInitial: null, telemetry: { active: true, data: { review: null, segment: "all", bar: [], automation: { hoursSavedWk: 0, runsThisWeek: 0, routinesOn: 0 } }, error: null, refresh: noop } });
    expectNoDemo(html);
    expect(html).toContain(esc(HOME_COPY.nothingWaiting));
    expect(html).toContain(esc(HOME_COPY.noDraftsYet)); // links to the recommended routine
    expect(html).toContain(esc(HOME_COPY.firstDay)); // no review, no brief → the first-day line
    expect(html).toContain(esc(HOME_COPY.noReceipts));
    expect(html).toContain(esc(HOME_COPY.nothingScheduled));
    expect(html).not.toContain("automation-strip");
    // Answers alone are not a saved plan.
    expect(html).toContain(esc(HOME_COPY.noPlan));
    expect(html).not.toContain("Content — your strength, running first");
    expect(html).toContain("data-testid=\"getting-set-up\"");
    // "Setting up next" = phase-1 wave-1 routines with honest availability
    expect(html).toContain("Founder content engine");
    expect(html).not.toContain("Recommended first");
    expect(html).not.toContain("Needs Klaviyo");
  });

  it("with real rows: live approval + draft + receipt render, the review bubble wins the headline, automation is real counts", () => {
    const S: PlatformState = { ...base, deadline: "2026-12-31", routineOn: { "Founder content engine": true }, connState: { Shopify: "ok" }, planAgreedAt: "2026-08-26T00:00:00.000Z" };
    const html = render(S, {
      accountMode: true,
      live: liveList({
        pendingCount: 1,
        approvals: [{ key: "ap-1", sys: "D01-W01", title: "Real decision from the runtime", detail: "d", before: "b", after: "a", expiry: "expires in 3h", pending: true, approved: false, held: false, showWhy: false, whyText: "w", outcomeText: "", busy: false, approve: noop, hold: noop, why: noop }],
        drafts: [{ runId: "r1", sys: "D01-W01", routineName: "Founder content engine", title: "3 founder posts drafted for your voice check", line: "Drafted from 12 customer questions." }],
        receipts: [{ id: "abcdef12-0000-4000-8000-000000000000", handle: "abcdef12", kind: "draft", text: "Founder content engine: drafts handed over." }],
      }),
      setup: setupState({ plans: [{ agreed_at: "2026-08-26T00:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }], routineStates: [{ routine_id: "D01-W01", enabled: true }], runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00Z" }] }),
      briefInitial: null,
      telemetry: { active: true, error: null, refresh: noop, data: { review: { weekStart: "2026-08-31", worked: "Three drafts landed.", changing: "Nothing yet.", ask: "Approve one.", changes: [], author: "deterministic", createdAt: "2026-09-01T00:00:00Z" }, segment: "all", bar: [], automation: { hoursSavedWk: 1.5, runsThisWeek: 1, routinesOn: 1 } } },
    });
    expectNoDemo(html);
    expect(html).toContain("Real decision from the runtime");
    expect(html).toContain("3 founder posts drafted for your voice check");
    expect(html).toContain("receipt abcdef12");
    expect(html).toContain("unc-self-review");
    expect(html).not.toContain(esc(HOME_COPY.firstDay));
    expect(html).toContain("automation-strip");
    expect(html).toContain("1 of 35 routines on · 1 run this week · ~1.5 h saved this week");
    // Agreement metadata in local state is not a persisted plan.
    expect(html).not.toContain("Weeks 1–5");
    expect(html).toContain(esc(HOME_COPY.noPlan));
    // running & next from real routine_states + the spec's cadence
    expect(html).toContain("daily at 07:00 · dry run");
    // No saved plan was supplied, so there are no inferred phase recommendations.
    expect(html).not.toContain("Customer-question mining");
  });

  it("the first-day line vs a brief: a brief in hand becomes the headline, the first-day line goes", () => {
    const brief = { id: "b1", accountId: "a", contextGeneration: 0, day: "2026-09-02", body: "One draft landed.", items: [], createdAt: "2026-09-02T06:30:00Z" };
    const html = render(base, { accountMode: true, live: liveList(), setup: setupState(), briefInitial: brief });
    expectNoDemo(html);
    expect(html).toContain(esc(BRIEF_GREETING));
    expect(html).not.toContain(esc(HOME_COPY.firstDay));
  });

  it("a routine on with no draft yet: the running variant of the empty line, the first-day running line", () => {
    const html = render({ ...base, routineOn: { "Founder content engine": true } }, { accountMode: true, live: liveList(), setup: setupState({ routineStates: [{ routine_id: "D01-W01", enabled: true }] }), briefInitial: null });
    expectNoDemo(html);
    expect(html).toContain(esc(HOME_COPY.noDraftsRunning));
    expect(html).toContain(esc(HOME_COPY.firstDayRunning));
  });

  it("Klaviyo: the reconnect card only when the real connector row says needs_reconnect (never the demo default)", () => {
    const none = render(base, { accountMode: true, live: liveList(), setup: setupState() });
    expect(none).not.toContain("klaviyo-reconnect");
    const real = render({ ...base, connState: { Klaviyo: "expired" } }, { accountMode: true, live: liveList(), setup: setupState({ connectors: [{ platform: "klaviyo", status: "needs_reconnect" }] }) });
    expect(real).toContain("klaviyo-reconnect");
    expect(real).toContain("Klaviyo needs reconnecting");
    expectNoDemo(real);
  });

  it("'Setting up next' blocks honestly on the routine's real connector: an Email plan needs Shopify until it is connected", () => {
    const email: PlatformState = { ...base, posture: "paid", obPostureSet: ["paid"], obStrengths: [], budgetMo: 0 };
    const facts = storedFacts({ title: "Email pilot", agreedAt: null, phases: [{ n: "1", name: "Email pilot", status: "DRAFT", routines: ["Abandoned cart recovery"], from_you: "Review drafts" }] });
    const blocked = render(email, { accountMode: true, live: liveList(), setup: setupState({ resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 } }) }, facts);
    expect(blocked).toContain("Abandoned cart recovery");
    expect(blocked).toContain("Needs Shopify connected");
    const ok = render({ ...email, connState: { Shopify: "ok" } }, { accountMode: true, live: liveList(), setup: setupState({ resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 }, connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }] }) }, facts);
    expect(ok).not.toContain("Needs Shopify connected");
    expectNoDemo(blocked);
  });

  it("a services firm (scanned: no store) on an Email plan: no cart, no Shopify anywhere on Home or the Connect step — the demo guard holds too", () => {
    const profile: BusinessProfile = { name: "Studio North", oneLiner: "A brand studio for founders.", category: "Agency", products: [], audience: "Founders", voice: { tone: null, phrases: [] }, market: { region: "NZ", competitorsMentioned: [] }, signals: [], confidence: "high", sources: [], businessType: "services", sells: "services", storefront: "none", businessTypeSource: "scan", typeEvidence: ["a services section"], platformsSpotted: [{ platform: "hubspot", evidence: "HubSpot forms or tracking on the site" }] };
    const services: PlatformState = { ...base, posture: "paid", obPostureSet: ["paid"], obStrengths: [], budgetMo: 0, obPlatforms: ["LinkedIn"], scan: { status: "done", key: "k", profile } };
    const setup = setupState({ resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0, known_platforms: ["LinkedIn"] }, businessProfile: { profile } });
    const html = render(services, { accountMode: true, live: liveList(), setup });
    expectNoDemo(html);
    expect(setup.data?.channel).toBe("Email & SMS");
    expect(html).not.toContain("Abandoned cart");
    expect(html).not.toContain("Winback");
    expect(html).not.toContain("Shopify");
    expect(html).toContain("Founder content engine"); // the generic wave-1 pick, in "Setting up next"
    expect(html).toContain("Connect LinkedIn");
    const step = renderToStaticMarkup(createElement(ConnectDataStep, { V: dv(services, ACCOUNT), channel: "Email & SMS", onConnect: async () => ({ kind: "fallback" as const, reason: "x" }), onContinue: noop, onLater: noop, onTokenLink: noop }));
    expect(step).not.toContain("connect-card-shopify");
    expect(step).not.toContain("Shopify");
    expect(step).toContain('data-testid="connect-card-linkedin"');
    expect(step).toContain('data-testid="connect-card-hubspot" data-status="off" data-source="spotted"');
    expect(step).toContain("Which tool sends your email?");
  });

  it("the Getting-set-up card collapses at 5/5 and is gone once dismissed", () => {
    const five = setupState({
      plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }],
      connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }],
      routineStates: [{ routine_id: "D01-W01", enabled: true }],
      runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00.000Z" }],
      firstTasteEventAt: "2026-09-02T08:00:00.000Z",
      latestBrief: { day: "2026-09-02" },
    });
    const collapsed = render({ ...base, routineOn: { "Founder content engine": true }, connState: { Shopify: "ok" } }, { accountMode: true, live: liveList(), setup: five });
    expect(collapsed).toContain("getting-set-up-done");
    expect(collapsed).toContain(esc(HOME_COPY.setupDone));
    const gone = render({ ...base, setupCardDismissed: true, routineOn: { "Founder content engine": true }, connState: { Shopify: "ok" } }, { accountMode: true, live: liveList(), setup: five });
    expect(gone).not.toContain("getting-set-up");
  });
});

/* ---------------- derive() in accounts mode: the root cause, at the source ---------------- */

const factsFor = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  accountId: "acct-1",
  connectors: [],
  routineStates: [],
  plan: null,
  resources: null,
  approvals: [],
  decided: [],
  runs: [],
  receipts: [],
  fetchedAt: NOW.toISOString(),
  ...over,
});

describe("derive(mode: account) — no catalog demo status, no catalog 'Active', nothing from the demo constants", () => {
  const empty = { ...accountInitialState("NZD"), onboarded: true, view: "today" as const };

  it("demo mode is the prototype (the guard is real): catalog connector defaults, catalog Active routines, the demo strips", () => {
    const D = dv(initialState);
    expect(D.connSummary).toBe("5 connected · 1 needs attention · 10 available");
    // a catalog-"Active" routine: the demo switch is on without any routine_states row
    const active = ALL_SYSTEMS.find((x) => x.state === "Active")!;
    expect(dv({ ...initialState, selCat: active.cat }).channelRows.find((r) => r.name === active.name)?.knobLeft).toBe("19.5px");
    expect(D.catCards.find((c) => c.name === active.cat)?.onLabel).not.toMatch(/^0 of/);
    expect(dv({ ...initialState, selCat: active.cat }, ACCOUNT).channelRows.find((r) => r.name === active.name)?.knobLeft).toBe("2.5px");
    expect(D.homeSetup).toHaveLength(4);
    expect(D.approvals).toHaveLength(3);
    expect(D.readChips).toHaveLength(3);
    expect(D.signals).toHaveLength(4);
    expect(D.completed).toHaveLength(3);
    expect(D.klaviyoDown).toBe(true); // the demo's `|| "expired"` default
    expect(D.accountMode).toBe(false);
    expect(D.obPlanReady).toBe(true);
  });

  it("a fresh account: every connector disconnected, every routine off, every demo strip empty, the honest labels", () => {
    const A = dv(empty, ACCOUNT);
    expect(A.accountMode).toBe(true);
    expect(A.connectors.every((c) => c.off)).toBe(true);
    expect(A.connSummary).toBe("Nothing connected yet");
    expect(A.enabledRoutineIds).toEqual([]);
    expect(A.routineOnById("D05-W01")).toBe(false);
    expect(A.catCards.every((c) => c.onLabel.startsWith("0 of "))).toBe(true);
    expect(A.visibleSystems.every((s) => s.state === "Off")).toBe(true);
    expect(A.homeSetup).toEqual([]);
    expect(A.approvals).toEqual([]);
    expect(A.readChips).toEqual([]);
    expect(A.signals).toEqual([]);
    expect(A.levers).toEqual([]);
    expect(A.focus).toEqual([]);
    expect(A.completed).toEqual([]);
    expect(A.homeBar).toEqual([]);
    expect(A.wfNodes).toEqual([]);
    expect(A.setupSteps).toEqual([]);
    expect(A.wfVersion).toBe("");
    expect(A.wfDraftMsg).toBe("");
    expect(A.strategicRead).toBe("");
    expect(A.klaviyoDown).toBe(false);
    expect(A.klaviyoOk).toBe(false);
    expect(A.klaviyoNeedsReconnect).toBe(false);
    expect(A.needsCount).toBe(0);
    expect(A.gamHrs).toBe(0);
    expect(A.gamRank).toBe("0%");
    expect(A.gamHireLine).not.toContain("Pro move");
    expect(A.homeAds).toBe(false); // brand posture, no paid phase in the first two
    expect(A.homePlan).toEqual([]); // no stored plan means no generated phases
    expect(A.goalMissing).toBe(true);
    expect(A.deadlineMissing).toBe(true);
    expect(A.daysLeftLabel).toBe("no deadline yet");
    expect(A.obBudgetLabel).toBe("Not set yet");
    expect(A.obHoursLabel).toBe("Not set yet");
    expect(A.obTargetSet).toBe(false);
    expect(A.obPlanReady).toBe(false);
    expect(A.obMissing.map((m) => m.step)).toEqual([1, 1, 3, 3]);
    expect(A.obPlanShort).toBe("");
    expect(A.obStrengthSummary).toBe("");
    expect(A.obConnCount).toBe(0);
    // "Setting up next" is the plan's phase-1 wave-1 routines — never the demo trio
    expect(A.proposals.map((p) => p.name)).not.toContain("PDP conversion review");
    expect(A.proposals.length).toBeGreaterThan(0);
    expect(A.proposals.every((p) => !p.building)).toBe(true);
  });

  it("the account's rows fill what the client state never touched (facts): Klaviyo really needing a reconnect, a pending decision, receipts, an enabled routine", () => {
    const f = factsFor({
      connectors: [{ platform: "klaviyo", name: "Klaviyo", status: "needs_reconnect", lastSyncAt: null, lastSyncResult: "error:token_expired" }, { platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" }],
      routineStates: [{ routineId: "D01-W01", name: "Founder content engine", enabled: true }],
      approvals: [{ id: "ap-1", routineId: null, title: "t", detail: "", before: "", after: "", reasoning: "", status: "pending", expiresAt: null, decidedAt: null }],
      receipts: [{ id: "abcdef12-0000-4000-8000-000000000000", kind: "draft", text: "Drafts handed over.", createdAt: NOW.toISOString() }],
    });
    const A = dv(empty, { ...ACCOUNT, facts: f });
    expect(A.klaviyoDown).toBe(true);
    expect(A.klaviyoNeedsReconnect).toBe(true);
    expect(A.connStateByName("Shopify")).toBe("ok");
    expect(A.connStateByName("Meta Ads")).toBe("off"); // catalog says "ok" — the account never connected it
    expect(A.connSummary).toBe("1 connected · Klaviyo needs attention");
    expect(A.needsCount).toBe(2);
    expect(A.pendingCount).toBe(1);
    expect(A.completed).toEqual([{ text: "Drafts handed over.", receipt: "draft · receipt abcdef12" }]);
    expect(A.enabledRoutineIds).toEqual(["D01-W01"]);
    expect(A.routineOnById("D05-W01")).toBe(false);
    // the client's own projection wins over the facts when both exist (it is updated in-session)
    expect(dv({ ...empty, connState: { Klaviyo: "ok" } }, { ...ACCOUNT, facts: f }).klaviyoDown).toBe(false);
  });

  it("a local agreement date does not manufacture a plan; the real clock drives days left", () => {
    const A = dv({ ...empty, deadline: "2026-12-31", planAgreedAt: "2026-08-26T00:00:00.000Z" }, ACCOUNT);
    expect(A.homePlan).toEqual([]);
    expect(A.daysLeftLabel).toMatch(/^(119|120) days$/); // 2 Sep → 31 Dec on the real clock (±1 for the machine's timezone), never the demo's 31 Aug
    expect(A.deadlineMissing).toBe(false);
  });

  it("the plan gate opens only when the founder has typed every input (0 budget is an answer)", () => {
    const ready = dv({ ...empty, goalTitle: "NZ$50,000 MRR", targetNum: 50000, deadline: "2026-12-31", budgetMo: 0, hoursWk: 4, obAnswered: { target: true, budget: true, hours: true } }, ACCOUNT);
    expect(ready.obPlanReady).toBe(true);
    expect(ready.obMissing).toEqual([]);
    expect(ready.obBudgetLabel).toBe("NZ$0/mo");
    const half = dv({ ...empty, goalTitle: "NZ$50,000 MRR", targetNum: 50000, obAnswered: { target: true, budget: false, hours: false } }, ACCOUNT);
    expect(half.obMissing.map((m) => m.label)).toEqual(["a deadline", "your growth budget (0 is a fine answer)", "your hours a week"]);
  });

  it("currencyForLocale: the country cookie wins, then the browser language's region, else USD", () => {
    expect(currencyForLocale({ country: "NZ", language: "en-US" })).toBe("NZD");
    expect(currencyForLocale({ country: null, language: "en-AU" })).toBe("AUD");
    expect(currencyForLocale({ language: "en-GB" })).toBe("GBP");
    expect(currencyForLocale({ language: "de-DE" })).toBe("EUR");
    expect(currencyForLocale({ language: "ja-JP" })).toBe("USD");
    expect(currencyForLocale({})).toBe("USD");
    expect(accountInitialState("AUD").currency).toBe("AUD");
    expect(accountInitialState().goalTitle).toBe("");
    expect(accountInitialState().messages).toEqual([]);
  });
});

/* ---------------- Home: the empty seed ---------------- */

describe("Home in accounts mode — a brand-new account (nothing typed yet)", () => {
  it("shows 'Goal not set' + Unc's ask and 'no deadline yet' — never the demo goal, numbers or days-left", () => {
    const html = render({ ...accountInitialState("NZD"), onboarded: true, view: "today" }, { accountMode: true, live: liveList(), setup: setupState(), briefInitial: null });
    expectNoDemo(html);
    expect(html).toContain("goal-not-set");
    expect(html).toContain(esc(HOME_COPY.goalNotSet));
    expect(html).toContain("no deadline yet");
    expect(html).toContain("placeholder=\"e.g. NZ$40,000 MRR\"");
    expect(html).not.toContain("days left");
  });
});

/* ---------------- Routines view + routine detail ---------------- */

const listingOff = (): RoutinesStateListing => ({
  routines: ALL_SYSTEMS.map<RoutineStateView>((sys) => ({ routineId: sys.id, name: sys.name, category: sys.cat, wave: 1, enabled: false, version: 1, availability: "draft_only" as RoutineStateView["availability"], availabilityCopy: "draft-only for now", canEnable: true, betterWith: [], betterWithCopy: null, recommended: sys.id === "D01-W01", lastRun: null, lastDraft: null, skillSource: "builtin" })),
  recommendedFirst: ["D01-W01"],
  planChannel: "Content",
  business: { businessType: null, sells: null, storefront: null },
  connected: [],
});
const acctRun = { accountId: "00000000-0000-4000-8000-00000000acc1", account: { currency: "NZD", budgetMonthly: 1200 }, persisted: true };
const demoRun = { accountId: "demo", account: { currency: "NZD", budgetMonthly: 3000 }, persisted: false };

describe("Routines in accounts mode — no demo constant can render", () => {
  it("demo: the id-hash 'saves ~N h/wk' and the catalog's Active defaults are there (the guard is real)", () => {
    const html = renderToStaticMarkup(createElement(RoutinesView, { V: dv({ ...initialState, onboarded: true, view: "systems", selCat: "Email & SMS" }), run: demoRun }));
    expect(html).toContain("saves ~");
    expect(html).toContain('left:19.5px'); // Welcome flow tuning is on by the catalog's demo default
  });

  it("accounts, a category: real rows only — every switch off, no 'saves ~', no catalog state pill", () => {
    const S = { ...base, view: "systems" as const, selCat: "Email & SMS" };
    const html = renderToStaticMarkup(createElement(RoutinesView, { V: dv(S, ACCOUNT), run: acctRun, initialLive: listingOff() }));
    expectNoDemo(html);
    const welcome = ALL_SYSTEMS.find((s) => s.name === "Welcome flow tuning")!;
    expect(html).toContain(`data-testid="routine-${welcome.id}" data-enabled="0"`);
    expect(html).not.toContain("left:19.5px");
    expect(html).toContain("draft-only for now");
  });

  it("accounts, all roles: the plan-start line and real 0-of-N counts", () => {
    const html = renderToStaticMarkup(createElement(RoutinesView, { V: dv({ ...base, view: "systems", selCat: "All" }, ACCOUNT), run: acctRun, initialLive: listingOff() }));
    expectNoDemo(html);
    expect(html).toContain("Your plan starts with Content");
    expect(html).not.toMatch(/[1-9] of \d+ on/);
  });

  it("accounts, routine detail: Off pill, the spec's chain, the real setup — none of the prototype's canvas / wizard / 'v12'", () => {
    const sel = ALL_SYSTEMS.find((s) => s.name === "Welcome flow tuning")!;
    const S = { ...base, view: "systems" as const, sel };
    const live = { active: true, loading: false, data: listingOff(), error: null, refresh: noop, patch: noop };
    const html = renderToStaticMarkup(createElement(RoutineDetail, { V: dv(S, ACCOUNT), run: acctRun, live }));
    expectNoDemo(html);
    expect(html).toContain('data-testid="detail-state"');
    expect(html).toContain(">Off · draft-only for now<");
    expect(html).toContain("Configuration not verified");
    expect(html).not.toContain("v1 · active");
    expect(html).toContain('data-testid="real-setup"');
    expect(html).toContain("Budget guardrail · NZD 1,200/mo");
    expect(html).not.toContain("Set this up");
  });
});

/* ---------------- Connectors view ---------------- */

const connListing = (over: Partial<ConnectorsStateListing> = {}): ConnectorsStateListing => ({ role: "owner", connectors: [], google: { configured: false, children: [] }, ...over });

describe("Connectors in accounts mode — untouched platforms are disconnected, never the catalog's demo status", () => {
  it("demo: Shopify/GA4/Meta/Instagram/Slack read Connected and Klaviyo asks for a Reconnect (the guard is real)", () => {
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V: dv({ ...initialState, onboarded: true, view: "connectors" }) }));
    expect(html).toContain("5 connected · 1 needs attention · 10 available");
    expect(html).toContain(">Reconnect<");
    expect((html.match(/>Connected</g) ?? []).length).toBe(5);
  });

  it("accounts, nothing connected: 'Nothing connected yet', every card offers Connect, no Reconnect, no Connected", () => {
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V: dv({ ...base, view: "connectors" }, ACCOUNT), initialLive: connListing() }));
    expectNoDemo(html);
    expect(html).toContain("Nothing connected yet");
    expect(html).not.toContain(">Reconnect<");
    expect(html).not.toContain(">Connected<");
    expect((html.match(/>Connect</g) ?? []).length).toBe(16);
  });

  it("accounts, one real row: only that card is Connected; Klaviyo only asks for a reconnect when its row says so", () => {
    const shopifyLive = connListing({
      connectors: [{ platform: "shopify", name: "Shopify", status: "connected", externalRef: "acme.myshopify.com", lastSyncAt: "2026-09-02T09:00:00.000Z", lastSyncResult: "ok", lastReadMetrics: 4, oauthConfigured: true, tokenPath: true }],
    });
    const V1 = dv({ ...base, view: "connectors" }, { ...ACCOUNT, facts: factsFor({ connectors: [{ platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: "2026-09-02T09:00:00.000Z", lastSyncResult: "ok" }] }) });
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V: V1, initialLive: shopifyLive }));
    expectNoDemo(html);
    expect((html.match(/>Connected</g) ?? []).length).toBe(1);
    expect(html).toContain("1 connected");
    expect(html).not.toContain(">Reconnect<");
    const V2 = dv({ ...base, view: "connectors" }, { ...ACCOUNT, facts: factsFor({ connectors: [{ platform: "klaviyo", name: "Klaviyo", status: "needs_reconnect", lastSyncAt: null, lastSyncResult: "error:token_expired" }] }) });
    expect(renderToStaticMarkup(createElement(ConnectorsView, { V: V2, initialLive: connListing() }))).toContain(">Reconnect<");
  });

  it("accounts, sealed but never synced: the card does not read Connected", () => {
    const live = connListing({
      connectors: [{ platform: "shopify", name: "Shopify", status: "connected", externalRef: "acme.myshopify.com", lastSyncAt: null, lastSyncResult: null, lastReadMetrics: null, oauthConfigured: true, tokenPath: true }],
    });
    const V = dv({ ...base, view: "connectors" }, { ...ACCOUNT, facts: factsFor({ connectors: [{ platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: null, lastSyncResult: null }] }) });
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V, initialLive: live }));
    expect(html).not.toContain(">Connected<");
    expect(html).toContain("Nothing connected yet");
  });

  it("members can inspect connector status but never see connect, select, reconnect or disconnect controls", () => {
    const S: PlatformState = { ...base, view: "connectors", connState: { Shopify: "ok", Klaviyo: "expired" } };
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V: dv(S, ACCOUNT), initialLive: connListing({ role: "member" }) }));
    expect(html).toContain("Owner managed");
    expect(html).not.toContain(">Connect<");
    expect(html).not.toContain(">Reconnect<");
    expect(html).not.toContain("Disconnect");
    expect(html).not.toContain("<select");
  });
});

/* ---------------- Onboarding defaults ---------------- */

describe("Onboarding in accounts mode — empty inputs with placeholders, a plan only on real answers", () => {
  const seed = accountInitialState("NZD");
  const ob = (S: PlatformState, opts?: DeriveOptions) => renderToStaticMarkup(createElement(Onboarding, { V: dv(S, opts) }));

  it("demo: the prototype's filled dataset (40,000 / 28,400 / NZ$3,600/mo / 6 h/wk) and a plan card with no gate", () => {
    const s1 = ob({ ...initialState, obStep: 1 });
    expect(s1).toContain('value="40000"');
    expect(s1).toContain('value="28400"');
    expect(s1).not.toContain("placeholder=");
    const s3 = ob({ ...initialState, obStep: 3 });
    expect(s3).toContain("NZ$3,600/mo");
    expect(s3).toContain("6 h/wk");
    const s6 = ob({ ...initialState, obStep: 6 });
    expect(s6).not.toContain(esc(PLAN_GATE_TITLE));
    expect(s6).toContain("Agree the plan");
    // the judgement under each phase, collapsed — the same source as Strategy's, the demo strings untouched
    expect((s6.match(/data-testid="onboarding-phase-why"/g) ?? []).length).toBe(3);
    expect(s6).toContain("Why this order · What flips it · The risk");
    expect(s6).toContain("<details");
    expect(s6).not.toContain("<details open");
    const demoReasoning = planReasoning({ posture: "brand", strengths: ["Writing", "Product"], budgetMo: 3600, hoursWk: 6, businessType: null, currencySymbol: "NZ$" });
    expect(s6).toContain(esc(demoReasoning.byChannel["Content"].whyThisOrder));
    expect(s6).toContain(esc(demoReasoning.byChannel["Email & SMS"].evidenceGate));
    expect(s6).toContain(esc(demoReasoning.byChannel["SEO"].risk));
  });

  it("step 1: no pre-filled goal, baseline or deadline — placeholders only", () => {
    const html = ob({ ...seed, obStep: 1 }, ACCOUNT);
    expectNoDemo(html);
    expect(html).not.toContain('value="40000"');
    expect(html).not.toContain('value="28400"');
    expect(html).toContain(`placeholder="${OB_PLACEHOLDERS.target}"`);
    expect(html).toContain(`placeholder="${OB_PLACEHOLDERS.baseline}"`);
    expect(html).toContain('value=""');
  });

  it("step 3: budget and hours are empty number fields with placeholders and the 0-is-fine note — never NZ$3,600 / 6 h", () => {
    const html = ob({ ...seed, obStep: 3 }, ACCOUNT);
    expectNoDemo(html);
    expect(html).toContain(`placeholder="${OB_PLACEHOLDERS.budget}"`);
    expect(html).toContain(`placeholder="${OB_PLACEHOLDERS.hours}"`);
    expect(html).toContain(esc(OB_BUDGET_UNSET_NOTE));
    expect(html).not.toContain("NZ$3,600/mo");
    expect(html).not.toContain('value="3600"');
    expect(html).not.toContain('value="6"');
    expect(html).not.toContain("6 h/wk");
  });

  it("step 6 on empty inputs: Unc asks for the four things and drafts no plan; once typed, the plan card and 'Agree the plan' appear", () => {
    const gate = ob({ ...seed, obStep: 6 }, ACCOUNT);
    expectNoDemo(gate);
    expect(gate).toContain(esc(PLAN_GATE_TITLE));
    expect((gate.match(/data-testid="plan-gate-item"/g) ?? []).length).toBe(4);
    expect(gate).not.toContain("Review business settings →");
    expect(gate).not.toContain("here’s the shortest path");
    const plan = ob({ ...base, onboarded: false, obStep: 6 }, ACCOUNT);
    expect(plan).not.toContain(esc(PLAN_GATE_TITLE));
    expect(plan).toContain("Agree the plan →");
    expect(plan).toContain("here’s the shortest path");
    expect(plan).toContain("NZ$50,000 of new ground by 31 Dec");
    expect((plan.match(/data-testid="onboarding-phase-why"/g) ?? []).length).toBe(3);
    expectNoDemo(plan);
  });
});
