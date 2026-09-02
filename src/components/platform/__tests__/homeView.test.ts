/* Home in accounts mode vs demo mode, rendered to a string (react-dom/server — no DOM, no
   browser): the two docs/BETA.md gaps. (1) A NULL baseline is "not set" — Unc asks for it
   instead of showing progress off the demo 28,400. (2) The three demo approval cards are
   demo furniture: a real account never sees them, not even while the live list is loading
   or after it failed. Demo mode is untouched either way. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AP_DATA, derive } from "@/lib/platform/derive";
import { BASELINE_NOT_SET_COPY } from "@/lib/platform/goal";
import { initialState, type PlatformState } from "@/lib/platform/state";
import HomeView from "../HomeView";
import type { LiveApprovals } from "../useLiveApprovals";

const noop = () => {};
const render = (S: PlatformState, props: { live?: LiveApprovals | null; accountMode?: boolean } = {}) => renderToStaticMarkup(createElement(HomeView, { V: derive(S, noop), ...props }));

const liveList = (over: Partial<LiveApprovals> = {}): LiveApprovals => ({ active: true, loading: false, error: null, approvals: [], pendingCount: 0, receipts: [], drafts: [], refresh: noop, ...over });

const DEMO_TITLES = AP_DATA.map((a) => a.title);
const accountState: PlatformState = { ...initialState, onboarded: true, view: "today" };

describe("Home — demo approval cards never render for a real account", () => {
  it("demo mode renders the three demo cards and the demo pace sentence", () => {
    const html = render(accountState);
    for (const t of DEMO_TITLES) expect(html).toContain(t.replace(/"/g, "&quot;"));
    expect(html).not.toContain("needs-you-loading");
  });

  it("accounts mode, live list still loading: no demo cards, a loading line instead", () => {
    const html = render(accountState, { accountMode: true, live: liveList({ active: false, loading: true }) });
    for (const t of DEMO_TITLES) expect(html).not.toContain(t.replace(/"/g, "&quot;"));
    expect(html).toContain("needs-you-loading");
    expect(html).not.toContain("Nothing needs you right now");
  });

  it("accounts mode, live list failed: no demo cards, the error line", () => {
    const html = render(accountState, { accountMode: true, live: liveList({ active: false, error: "couldn’t load approvals (500)" }) });
    for (const t of DEMO_TITLES) expect(html).not.toContain(t.replace(/"/g, "&quot;"));
    expect(html).toContain("Couldn’t reach the runtime just now");
    expect(html).not.toContain("needs-you-loading");
  });

  it("accounts mode, live list in hand: the runtime's cards (or nothing waiting), never the demo ones — and the badge counts only live items", () => {
    const empty = render({ ...accountState, apStatus: ["pending", "pending", "pending"] }, { accountMode: true, live: liveList() });
    for (const t of DEMO_TITLES) expect(empty).not.toContain(t.replace(/"/g, "&quot;"));
    expect(empty).toContain("nothing-waiting");
    const withOne = render(accountState, {
      accountMode: true,
      live: liveList({
        pendingCount: 1,
        approvals: [{ key: "ap-1", sys: "D02-W01", title: "Real decision from the runtime", detail: "d", before: "b", after: "a", expiry: "expires in 3h", pending: true, approved: false, held: false, showWhy: false, whyText: "w", outcomeText: "", busy: false, approve: noop, hold: noop, why: noop }],
      }),
    });
    expect(withOne).toContain("Real decision from the runtime");
    for (const t of DEMO_TITLES) expect(withOne).not.toContain(t.replace(/"/g, "&quot;"));
  });
});

describe("Home — a NULL baseline is not the demo 28,400", () => {
  const nullBaseline: PlatformState = { ...accountState, baselineNum: null, baselineText: "", goalTitle: "NZ$100,000 monthly revenue", deadline: "2027-01-15" };

  it("accounts mode: Unc asks for the baseline, the pill reads 'Baseline not set', the bar is empty, no pace sentence", () => {
    const html = render(nullBaseline, { accountMode: true, live: liveList() });
    expect(html).toContain(BASELINE_NOT_SET_COPY);
    expect(html).toContain("baseline-not-set");
    expect(html).toContain('aria-label="Where it is now"');
    expect(html).toContain("width:0%");
    expect(html).not.toMatch(/On track|Behind by/);
    expect(html).not.toMatch(/At today.s pace|On pace for/);
    expect(html).not.toContain("28,400");
  });

  it("accounts mode with a baseline set: the normal header (pill, bar, sentence)", () => {
    const html = render({ ...nullBaseline, baselineNum: 35000 }, { accountMode: true, live: liveList() });
    expect(html).not.toContain(BASELINE_NOT_SET_COPY);
    expect(html).toMatch(/On track|Behind by/);
  });

  it("demo mode never shows the ask (the demo state always has a baseline; a cleared field falls back to demo maths as before)", () => {
    const html = render(nullBaseline);
    expect(html).not.toContain(BASELINE_NOT_SET_COPY);
    expect(html).toMatch(/On track|Behind by/);
  });

  it("derive: baselineMissing flags null only; a found 0 is a baseline", () => {
    expect(derive({ ...initialState, baselineNum: null }, noop).baselineMissing).toBe(true);
    expect(derive({ ...initialState, baselineNum: 0 }, noop).baselineMissing).toBe(false);
    expect(derive(initialState, noop).baselineMissing).toBe(false);
  });
});
