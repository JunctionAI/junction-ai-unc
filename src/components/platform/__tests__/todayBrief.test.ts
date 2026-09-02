/* The daily brief on Home, rendered to a string (react-dom/server): demo mode is byte-identical
   (nothing of the brief appears); accounts mode renders the card with a chip per kind, the
   needs_you anchor to the approval card, the reminder date, and the ghost pill when no brief
   exists yet. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DailyBriefRecord } from "@/lib/brain/brief";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import HomeView from "../HomeView";
import TodayBrief, { approvalAnchorId, BRIEF_GREETING, GENERATE_LABEL, TodayBriefCard } from "../TodayBrief";
import type { LiveApprovals } from "../useLiveApprovals";

const noop = () => {};
const accountState: PlatformState = { ...initialState, onboarded: true, view: "today" };
const renderHome = (S: PlatformState, props: { live?: LiveApprovals | null; accountMode?: boolean } = {}) => renderToStaticMarkup(createElement(HomeView, { V: derive(S, noop), ...props }));
const liveList = (over: Partial<LiveApprovals> = {}): LiveApprovals => ({ active: true, loading: false, error: null, approvals: [], pendingCount: 0, receipts: [], drafts: [], refresh: noop, ...over });

const BRIEF: DailyBriefRecord = {
  id: "b1",
  accountId: "acct-1",
  day: "2026-09-03",
  body: "Overnight I completed 1 run and wrote 1 draft; 1 decision is waiting on you.",
  createdAt: "2026-09-02T18:31:00.000Z",
  items: [
    { kind: "needs_you", text: "Move NZD 20/day to Prospecting NZ — waiting on your okay.", ref: "ap-1" },
    { kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7% on a week ago.", ref: "revenue_7d" },
    { kind: "reminder", text: "Spring launch goes live.", ref: "ev-1", at: "2026-09-05T21:00:00.000Z" },
    { kind: "happened", text: "I completed 1 run and left 1 draft for you.", ref: "rc-2" },
  ],
};

describe("TodayBrief — demo mode is byte-identical", () => {
  it("renders nothing at all outside accounts mode, even with a brief in hand", () => {
    expect(renderToStaticMarkup(createElement(TodayBrief, { accountMode: false, initial: BRIEF }))).toBe("");
    expect(renderToStaticMarkup(createElement(TodayBrief, { accountMode: false }))).toBe("");
  });

  it("the demo Home carries no trace of the brief", () => {
    const html = renderHome(accountState);
    expect(html).not.toContain("today-brief");
    expect(html).not.toContain(BRIEF_GREETING);
    expect(html).not.toContain(GENERATE_LABEL);
    expect(html).not.toContain('id="approval-');
  });
});

describe("TodayBrief — accounts mode", () => {
  it("before the fetch answers: nothing (no flash); with no brief yet: the quiet ghost pill", () => {
    expect(renderToStaticMarkup(createElement(TodayBrief, { accountMode: true }))).toBe("");
    const empty = renderToStaticMarkup(createElement(TodayBrief, { accountMode: true, initial: null }));
    expect(empty).toContain("today-brief-empty");
    expect(empty).toContain(GENERATE_LABEL);
    expect(empty).not.toContain(BRIEF_GREETING);
  });

  it("the card: greeting + day + body, a chip per kind, needs_you linking to the approval, the reminder's date", () => {
    const html = renderToStaticMarkup(createElement(TodayBriefCard, { brief: BRIEF }));
    expect(html).toContain('data-testid="today-brief"');
    expect(html).toContain(BRIEF_GREETING);
    expect(html).toContain("2026-09-03");
    expect(html).toContain(BRIEF.body);
    for (const kind of ["needs_you", "noticed", "reminder", "happened"]) expect(html).toContain(`data-kind="${kind}"`);
    expect(html).toContain("NEEDS YOU");
    expect(html).toContain("NOTICED");
    expect(html).toContain("REMINDER");
    expect(html).toContain("DONE");
    expect(html).toContain(`href="#${approvalAnchorId("ap-1")}"`);
    expect(html).toMatch(/Sun, 6 Sep|Sat, 5 Sep/); // the viewer's zone decides the calendar day
    expect(html).not.toContain(GENERATE_LABEL);
    expect(renderToStaticMarkup(createElement(TodayBrief, { accountMode: true, initial: BRIEF }))).toBe(html);
  });

  it("Home in accounts mode gives each live approval card the anchor the brief links to", () => {
    const html = renderHome(accountState, {
      accountMode: true,
      live: liveList({
        pendingCount: 1,
        approvals: [{ key: "ap-1", sys: "D02-W01", title: "Real decision from the runtime", detail: "d", before: "b", after: "a", expiry: "expires in 3h", pending: true, approved: false, held: false, showWhy: false, whyText: "w", outcomeText: "", busy: false, approve: noop, hold: noop, why: noop }],
      }),
    });
    expect(html).toContain(`id="${approvalAnchorId("ap-1")}"`);
    expect(html).toContain("Real decision from the runtime");
  });
});
