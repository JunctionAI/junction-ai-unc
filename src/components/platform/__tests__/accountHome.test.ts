/* Home in accounts mode renders NOTHING from derive.ts's demo constants — asserted as a list
   of demo phrases that must be absent in every accounts-mode state (loading, empty, populated),
   while the copy floor of docs/PRODUCT-EXPERIENCE.md is present. Rendered with
   react-dom/server (no DOM, no fetch). Demo mode is untouched: the same phrases ARE there. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AP_DATA, AP_WHY_TEXTS, COMPLETED_DEFS, LEVER_DEFS, SIGNAL_DEFS, derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import { HOME_COPY } from "@/lib/setup/home";
import { computeSetupProgress } from "@/lib/setup/progress";
import { BRIEF_GREETING } from "../TodayBrief";
import HomeView, { type HomeViewProps } from "../HomeView";
import type { LiveApprovals } from "../useLiveApprovals";
import type { HomeTelemetryState } from "../useHomeTelemetry";
import type { SetupProgressState } from "@/lib/setup/useSetupProgress";

const noop = () => {};
const esc = (t: string) => t.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const render = (S: PlatformState, props: Partial<HomeViewProps> = {}) => renderToStaticMarkup(createElement(HomeView, { V: derive(S, noop), ...props }));

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
];

const base: PlatformState = { ...initialState, onboarded: true, view: "today", baselineNum: null, baselineText: "", routineOn: {}, connState: {} };

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
    // the plan is real: phase 1 from the founder's own answers, with no demo week anchor
    expect(html).toContain("Content — your strength, running first");
    expect(html).toContain("data-testid=\"getting-set-up\"");
    // "Setting up next" = phase-1 wave-1 routines with honest availability
    expect(html).toContain("Founder content engine");
    expect(html).toContain("Recommended first");
    expect(html).toContain("Draft-only for now");
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
      setup: setupState({ plans: [{ agreed_at: "2026-08-26T00:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected" }], routineStates: [{ routine_id: "D01-W01", enabled: true }], runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00Z" }] }),
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
    // real weeks from agreed_at (26 Aug → 31 Dec deadline ≈ 18 weeks: phase 1 = weeks 1–5)
    expect(html).toContain("Weeks 1–5");
    expect(html).toContain("agreed 26 Aug");
    // running & next from real routine_states + the spec's cadence
    expect(html).toContain("daily at 07:00 · dry run");
    // the recommended card moved on to the next wave-1 routine of the channel
    expect(html).toContain("Customer-question mining");
  });

  it("the first-day line vs a brief: a brief in hand becomes the headline, the first-day line goes", () => {
    const brief = { id: "b1", accountId: "a", day: "2026-09-02", body: "One draft landed.", items: [], createdAt: "2026-09-02T06:30:00Z" };
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
    const blocked = render(email, { accountMode: true, live: liveList(), setup: setupState({ resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 } }) });
    expect(blocked).toContain("Abandoned cart recovery");
    expect(blocked).toContain("Needs Shopify connected");
    const ok = render({ ...email, connState: { Shopify: "ok" } }, { accountMode: true, live: liveList(), setup: setupState({ resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 }, connectors: [{ platform: "shopify", status: "connected" }] }) });
    expect(ok).not.toContain("Needs Shopify connected");
    expectNoDemo(blocked);
  });

  it("the Getting-set-up card collapses at 5/5 and is gone once dismissed", () => {
    const five = setupState({
      plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }],
      connectors: [{ platform: "shopify", status: "connected" }],
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
