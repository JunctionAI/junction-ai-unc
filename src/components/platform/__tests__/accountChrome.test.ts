/* Sidebar / Strategy / corner buddy in accounts mode vs demo mode, rendered to a string
   (react-dom/server — no DOM). Accounts mode (docs/PRODUCT-EXPERIENCE.md "Real only"): the
   connector line and routines count come from the account's rows, the Strategy header carries
   the agreed date (or "draft"), phases show real on-counts and never a demo evidence gate, the
   corner thread never shows the prototype's seeded lines, and the buddy bubble states real
   counts. Demo mode renders the prototype verbatim, with the demo banner mounted. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import { __setAccountFactsForTests, type AccountFacts, type AccountFactsState } from "@/lib/unc/accountFacts";
import type { Persistence } from "@/lib/db/useAccountPersistence";
import CornerBuddy, { accountBubble, accountThread, FIRST_UNC_LINE, HUMAN_LANE_NOTE } from "../CornerBuddy";
import { mergeThread, viaLabel, type ThreadRow } from "../useChannelThread";
import { DEMO_BANNER_COPY } from "../DemoBanner";
import Sidebar, { accountConnectorLine } from "../Sidebar";
import StrategyView, { accountPhases, accountWhy } from "../StrategyView";

const noop = () => {};
const NOW = new Date("2026-09-02T09:00:00.000Z");

const facts = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  accountId: "acct-1",
  connectors: [
    { platform: "shopify", name: "Shopify", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" },
    { platform: "ga4", name: "Google Analytics 4", status: "connected", lastSyncAt: "2026-09-01T20:00:00.000Z", lastSyncResult: "ok" },
    { platform: "klaviyo", name: "Klaviyo", status: "needs_reconnect", lastSyncAt: null, lastSyncResult: "error:token_expired" },
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
      { n: "4", name: "Scale the organization", status: "GATED · NZ$40k MRR", routines: ["Specialist agents", "First human hire"], from_you: "Hire and graduation decisions." },
    ],
  },
  resources: { budgetMonthly: 3600, hoursWeekly: 6, skills: ["Writing", "Product"], postures: ["brand_led"] },
  approvals: [{ id: "ap-1", routineId: "D05-W01", title: "Send welcome email 2", detail: "", before: "", after: "", reasoning: "", status: "pending", expiresAt: null, decidedAt: null }],
  decided: [],
  runs: [
    { id: "run-2", routineId: "D01-W01", mode: "dry_run", status: "done", startedAt: "2026-09-02T07:00:00.000Z" },
    { id: "run-1", routineId: "D05-W01", mode: "dry_run", status: "done", startedAt: "2026-09-01T07:00:00.000Z" },
  ],
  receipts: [],
  fetchedAt: NOW.toISOString(),
  ...over,
});

const account = (over: Partial<AccountFactsState> = {}): AccountFactsState => ({ mode: "account", accountId: "acct-1", facts: facts(), loading: false, error: null, ...over });
const persistence: Persistence = { mode: "account", accountId: "acct-1", userEmail: "ana@example.test", accountName: "", setAccountName: () => {}, autosave: "saved", error: null };

const state = (over: Partial<PlatformState> = {}): PlatformState => ({ ...initialState, onboarded: true, view: "today", ...over });
const V = (S: PlatformState) => derive(S, noop);

afterEach(() => __setAccountFactsForTests(null));

describe("Sidebar", () => {
  it("demo mode: the catalog count, the demo connector line, 'Demonstration data'", () => {
    __setAccountFactsForTests(null); // env absent ⇒ demo
    const html = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: null }));
    expect(html).toContain("5 connected · 1 needs attention · 10 available");
    expect(html).toContain(`data-testid="sidebar-routines-count"`);
    expect(html).toContain(">35<");
    expect(html).toContain("Demonstration data.");
    expect(html).not.toContain(" on<");
  });

  it("accounts mode: the connector line and routines count from the account's rows, no demo line", () => {
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: persistence }));
    expect(html).toContain("2 connected · Klaviyo needs attention →");
    expect(html).toContain(">3 on<");
    expect(html).not.toContain("5 connected · 1 needs attention · 10 available");
    expect(html).not.toContain("Demonstration data");
    expect(html).not.toContain("No live connectors or outward actions");
    expect(html).toContain("Nothing sends or spends without your okay.");
    expect(html).toContain("ana@example.test");
  });

  it("accounts mode before the rows arrive: honest loading / empty lines, never the demo numbers", () => {
    __setAccountFactsForTests(account({ facts: null, loading: true }));
    const html = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: persistence }));
    expect(html).toContain("Reading your connections…");
    expect(html).toContain(">0 on<");
    expect(accountConnectorLine(null, false)).toBe("Nothing connected yet");
  });

  it("the demo banner copy is the spec's line and the banner is never part of an account render", () => {
    expect(DEMO_BANNER_COPY).toBe("Demo data — nothing here is yours. Sign in to start for real.");
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: persistence }));
    expect(html).not.toContain('data-testid="demo-banner"');
    expect(html).not.toContain(DEMO_BANNER_COPY);
  });
});

describe("StrategyView", () => {
  it("demo mode: the prototype verbatim (agreed 12 Aug, evidence gates)", () => {
    __setAccountFactsForTests(null);
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect(html).toContain("agreed 12 Aug · reviewed monthly · persists until superseded");
    expect(html).toContain("GATED · repeat ≥ 18%");
    expect(html).toContain("Chosen with you on 12 Aug");
  });

  it("accounts mode: the agreed date from the plan row, real on-counts, no gated pill, a rationale from the founder's own numbers", () => {
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect(html).toContain("agreed 20 Aug · persists until superseded");
    expect(html).not.toContain("reviewed monthly");
    expect(html).not.toContain("12 Aug");
    expect(html).not.toContain("GATED");
    expect(html).not.toContain("repeat ≥ 18%");
    expect(html).toContain("2 of 3 routines on");
    expect(html).toContain("1 of 3 routines on");
    expect(html).toContain("0 of 2 routines on");
    expect(html).toContain(">ACTIVE<");
    expect(html).toContain(">READY WHEN YOU ARE<");
    expect(html).not.toContain("START HERE"); // phase 1 has routines on
    expect(html).toContain("We agreed it on 20 Aug.");
    expect(html).toContain("NZ$3,600/mo for paid, 6 h/wk of your time");
    expect(html).toContain("one phase at a time, on your say-so");
  });

  it("accounts mode with no plan row and nothing on: draft header, START HERE on phase 1, everything else ready when you are", () => {
    __setAccountFactsForTests(account({ facts: facts({ plan: null, routineStates: [] }) }));
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect(html).toContain("draft — not agreed yet");
    expect(html).toContain(">START HERE<");
    expect(html).toContain("It stays a draft until you agree it from Home.");
    expect(html).not.toContain(">ACTIVE<");
    expect(html).not.toContain("GATED");
    expect((html.match(/READY WHEN YOU ARE/g) ?? []).length).toBe(3);
  });

  it("accountPhases / accountWhy are pure over the rows", () => {
    const ph = accountPhases(V(state({ view: "strategy" })), facts());
    expect(ph.map((p) => [p.name, p.on, p.st])).toEqual([
      ["Organic brand engine", 2, "ACTIVE"],
      ["Retention & lifecycle", 1, "ACTIVE"],
      ["Paid amplification", 0, "READY WHEN YOU ARE"],
      ["Scale the organization", 0, "READY WHEN YOU ARE"],
    ]);
    const why = accountWhy({ postureName: "Brand-led organic", obBudgetLabel: "NZ$900/mo", obHoursLabel: "3 h/wk", obStrengthSummary: "" }, null, []);
    expect(why).toContain("none picked yet");
    expect(why).toContain("It stays a draft until you agree it from Home.");
    expect(why).not.toMatch(/\d+ Aug/);
  });
});

describe("CornerBuddy", () => {
  it("demo mode: the prototype's seeded thread and the section's demo bubble", () => {
    __setAccountFactsForTests(null);
    const html = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true })) }));
    expect(html).toContain("Prospecting-B");
    const bubble = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ buddyText: "Only you can clear these. Three taps and the machine keeps moving without you." })) }));
    expect(bubble).toContain("Only you can clear these.");
  });

  it("accounts mode: a demo-seeded (or empty) corner thread opens with Unc's one line, never the prototype's", () => {
    __setAccountFactsForTests(account());
    const seeded = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true })) }));
    expect(seeded).toContain(FIRST_UNC_LINE);
    expect(seeded).not.toContain("Prospecting-B");
    expect(seeded).not.toContain("Morning Tom");
    const empty = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true, messages: [] })) }));
    expect(empty).toContain(FIRST_UNC_LINE);
    const real = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true, messages: [...initialState.messages, { from: "u", text: "How is the welcome flow going?" }, { from: "j", text: "Waiting on the Klaviyo reconnect." }] })) }));
    expect(real).toContain("How is the welcome flow going?");
    expect(real).toContain("Waiting on the Klaviyo reconnect.");
    expect(real).not.toContain(FIRST_UNC_LINE);
    expect(real).not.toContain("Prospecting-B");
  });

  it("accounts mode: the human lane is honest — no fake Sam thread, the composer is off, support@ is the way in", () => {
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true, chatMode: "human" })) }));
    expect(html).toContain(HUMAN_LANE_NOTE);
    expect(html).toContain("mailto:support@getjunction.ai");
    expect(html).not.toContain("Kia ora — Sam");
    expect(html).not.toContain("welcome-flow voiceover");
    expect(html).toContain("disabled");
  });

  it("accounts mode: the bubble carries real counts per view, never the demo lines", () => {
    __setAccountFactsForTests(account());
    const demoLine = "Only you can clear these. Three taps and the machine keeps moving without you.";
    const home = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ buddyText: demoLine })) }));
    expect(home).toContain("3 routines on · 1 decision waiting · 2 drafts this week.");
    expect(home).not.toContain("Three taps");
    const routines = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ view: "systems", buddyText: "Every routine you switch on makes the machine more OP" })) }));
    expect(routines).toContain("3 of 35 routines on. Turn another on and I dry-run it now");
    expect(routines).not.toContain("more OP");
    const connectors = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ view: "connectors", buddyText: "Least privilege, always — I list every scope" })) }));
    expect(connectors).toContain("2 connected · Klaviyo needs attention. Each connection unlocks more of the library");
    // Strategy sets its own real-fact data-buddy text, which passes through untouched
    expect(accountBubble({ isStrategy: true, isSystems: false, isConnectors: false, buddyText: "3 routines on under this play.", libTotal: 35 }, facts(), NOW)).toBe("3 routines on under this play.");
    // nothing on yet
    expect(accountBubble({ isStrategy: false, isSystems: true, isConnectors: false, buddyText: "x", libTotal: 35 }, facts({ routineStates: [] }), NOW)).toBe("Nothing on yet. Turn one on and I dry-run it now — nothing sends without you.");
  });

  it("accountThread strips only the demo seed", () => {
    const msg = (text: string, fromUser = false) => ({ text, fromUser, fromJunction: !fromUser, typing: false, link: false, linkLabel: undefined, linkGo: noop });
    const seed = initialState.messages.map((m) => msg(m.text, m.from === "u"));
    expect(accountThread(seed, "ai").map((m) => m.text)).toEqual([FIRST_UNC_LINE]);
    expect(accountThread([...seed, msg("hi", true)], "ai").map((m) => m.text)).toEqual(["hi"]);
    expect(accountThread([], "human")).toEqual([]);
  });
});

describe("Sidebar — Channels entry (docs/CHANNELS.md mount)", () => {
  it("accounts mode has the Channels nav entry; demo mode never does (the view fetches /api/channels/links)", () => {
    __setAccountFactsForTests(account());
    const acct = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: persistence }));
    expect(acct).toContain('data-testid="sidebar-channels"');
    expect(acct).toContain(">Channels<");
    __setAccountFactsForTests(null);
    const demo = renderToStaticMarkup(createElement(Sidebar, { V: V(state()), account: null }));
    expect(demo).not.toContain("sidebar-channels");
  });
});

describe("CornerBuddy — one conversation: channel turns with a 'via' chip, in time order", () => {
  const rows: ThreadRow[] = [
    { id: "t1", at: "2026-09-02T08:00:00.000Z", sender: "user", body: "Approve the welcome email", channel: "telegram" },
    { id: "t2", at: "2026-09-02T08:00:05.000Z", sender: "unc", body: "Done — approved. Receipt lands in the app.", channel: "telegram" },
    { id: "s1", at: "2026-09-02T08:00:06.000Z", sender: "staff", body: "never on this thread", channel: "app" },
  ];

  it("accounts mode renders the Telegram turns as the same bubbles with the chip; no 'first line' placeholder once there is a thread", () => {
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true, messages: [] })), initialThread: rows }));
    expect((html.match(/data-testid="via-chip"/g) ?? []).length).toBe(2);
    expect(html).toContain("via Telegram");
    expect(html).toContain("Approve the welcome email");
    expect(html).toContain("Done — approved. Receipt lands in the app.");
    expect(html).not.toContain(FIRST_UNC_LINE);
    expect(html).not.toContain("never on this thread");
    // the chip: 10px, uppercase, cyan wash — never amber
    expect(html).toMatch(/via-chip" style="[^"]*font-size:10px[^"]*text-transform:uppercase[^"]*background:var\(--cyan-wash\)/);
  });

  it("demo mode ignores channel rows entirely (the prototype's thread, no chip)", () => {
    __setAccountFactsForTests(null);
    const html = renderToStaticMarkup(createElement(CornerBuddy, { V: V(state({ chatOpen: true })), initialThread: rows }));
    expect(html).not.toContain("via-chip");
    expect(html).not.toContain("via Telegram");
  });

  it("mergeThread interleaves by time using the app's own rows as anchors; staff rows are dropped; a stripped demo seed offsets the anchors", () => {
    const local = ["a", "b"];
    const remote: ThreadRow[] = [
      { id: "r1", at: "2026-09-02T08:00:00.000Z", sender: "user", body: "a", channel: "app" },
      { id: "r2", at: "2026-09-02T08:01:00.000Z", sender: "user", body: "tg1", channel: "telegram" },
      { id: "r3", at: "2026-09-02T08:02:00.000Z", sender: "unc", body: "b", channel: "app" },
      { id: "r4", at: "2026-09-02T08:03:00.000Z", sender: "unc", body: "wa1", channel: "whatsapp" },
      { id: "r5", at: "2026-09-02T08:00:30.000Z", sender: "staff", body: "staff", channel: "slack" },
    ];
    expect(mergeThread(local, remote, (r) => r.body)).toEqual(["a", "tg1", "b", "wa1"]);
    // three seed rows were stripped from `local` but still sit in the thread as app rows
    const seeded: ThreadRow[] = [
      ...["s1", "s2", "s3"].map((id, i) => ({ id, at: `2026-09-01T00:0${i}:00.000Z`, sender: "unc" as const, body: id, channel: "app" as const })),
      ...remote,
    ];
    expect(mergeThread(local, seeded, (r) => r.body)).toEqual(["a", "tg1", "b", "wa1"]);
    // channel rows before any app row lead; rows after unsaved local turns land at the end
    expect(mergeThread(["x"], [{ id: "e", at: "2026-09-01T00:00:00.000Z", sender: "user", body: "early", channel: "sms" }], (r) => r.body)).toEqual(["early", "x"]);
    expect(viaLabel("sms")).toBe("via Text");
    expect(viaLabel("whatsapp")).toBe("via WhatsApp");
    expect(viaLabel("app")).toBeNull();
  });
});
